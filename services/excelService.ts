import JSZip from 'jszip';
import { translateBatch } from './geminiService';
import { TranslationProgress } from '../types';

// Helper to identify if text contains Japanese characters
const hasJapanese = (text: string): boolean => {
  return /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(text);
};

export class ExcelProcessor {
  private zip: JSZip | null = null;
  private uniqueStrings: Set<string>;
  private translationMap: Map<string, string>;

  constructor() {
    this.uniqueStrings = new Set();
    this.translationMap = new Map();
  }

  async loadFile(file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    this.zip = new JSZip();
    await this.zip.loadAsync(buffer);
  }

  async extractStrings(): Promise<void> {
    if (!this.zip) return;
    this.uniqueStrings.clear();

    const textPromises: Promise<void>[] = [];

    // 1. Shared Strings (Main Cell Content)
    const sharedStringsFile = this.zip.file('xl/sharedStrings.xml');
    if (sharedStringsFile) {
      textPromises.push((async () => {
        const xml = await sharedStringsFile.async('string');
        this.extractFromSharedStrings(xml);
      })());
    }

    // 2. Worksheets (Inline Strings)
    this.zip.forEach((path, file) => {
      if (path.match(/xl\/worksheets\/sheet.*\.xml/)) {
        textPromises.push((async () => {
          const xml = await file.async('string');
          this.extractFromTag(xml, 't', true); // Inline strings are usually in <is><t>...
        })());
      }
    });

    // 3. Drawings (Text Boxes, Shapes)
    this.zip.forEach((path, file) => {
      if (path.match(/xl\/drawings\/drawing.*\.xml/)) {
        textPromises.push((async () => {
          const xml = await file.async('string');
          this.extractFromTag(xml, 'a:t');
        })());
      }
    });

    // 4. Charts (Titles, Labels)
    this.zip.forEach((path, file) => {
      if (path.match(/xl\/charts\/chart.*\.xml/)) {
        textPromises.push((async () => {
          const xml = await file.async('string');
          this.extractFromTag(xml, 'a:t');
        })());
      }
    });

    // 5. Workbook (Sheet Names)
    const workbookFile = this.zip.file('xl/workbook.xml');
    if (workbookFile) {
      textPromises.push((async () => {
        const xml = await workbookFile.async('string');
        this.extractFromSheetNames(xml);
      })());
    }

    await Promise.all(textPromises);
  }

  // Specific extractor for SharedStrings to handle complex <si> structures
  private extractFromSharedStrings(xml: string) {
    // Shared strings are wrapped in <si>...</si>
    const siRegex = /<si>([\s\S]*?)<\/si>/g;
    let match;
    while ((match = siRegex.exec(xml)) !== null) {
      const innerContent = match[1];
      // 1. Remove Phonetic Guides (<rPh>...</rPh>) entirely
      const cleanContent = innerContent.replace(/<rPh>[\s\S]*?<\/rPh>/g, '');
      
      // 2. Extract all text from <t> tags and concatenate
      let fullText = '';
      const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      let tMatch;
      while ((tMatch = tRegex.exec(cleanContent)) !== null) {
        fullText += tMatch[1];
      }

      const decoded = this.decodeXml(fullText);
      if (decoded && hasJapanese(decoded)) {
        this.uniqueStrings.add(decoded);
      }
    }
  }

  // Generic extractor for simple tags like <t> or <a:t>
  private extractFromTag(xml: string, tagName: string, checkInlineParent = false) {
    // Regex matches <tagName attributes...>Content</tagName>
    const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'g');
    let match;
    while ((match = regex.exec(xml)) !== null) {
      // If checking for inline strings, ensure strict context if needed, but usually <t> scan is fine
      // provided we are in a sheet file.
      const text = match[1];
      const decoded = this.decodeXml(text);
      if (decoded && hasJapanese(decoded)) {
        this.uniqueStrings.add(decoded);
      }
    }
  }

  // Extractor for sheet names from workbook.xml
  private extractFromSheetNames(xml: string) {
      // Matches <sheet ... name="Value" ... />
      const sheetTagRegex = /<sheet\s+[^>]*>/g;
      let match;
      while ((match = sheetTagRegex.exec(xml)) !== null) {
          const tagContent = match[0];
          const nameMatch = tagContent.match(/name="([^"]+)"/);
          if (nameMatch) {
              const decoded = this.decodeXml(nameMatch[1]);
              if (hasJapanese(decoded)) {
                  this.uniqueStrings.add(decoded);
              }
          }
      }
  }

  async processTranslations(
    onProgress: (progress: TranslationProgress) => void
  ): Promise<void> {
    const allStrings = Array.from(this.uniqueStrings);
    const BATCH_SIZE = 20; // Reduced from 30 to 20 to lower token usage per request
    const totalChunks = Math.ceil(allStrings.length / BATCH_SIZE);

    if (totalChunks === 0) {
        onProgress({ status: 'rebuilding', currentChunk: 0, totalChunks: 0, message: "No Japanese text found." });
        return;
    }

    for (let i = 0; i < totalChunks; i++) {
      const start = i * BATCH_SIZE;
      const end = start + BATCH_SIZE;
      const chunk = allStrings.slice(start, end);

      onProgress({ 
        status: 'translating', 
        currentChunk: i + 1, 
        totalChunks, 
        message: `Translating batch ${i + 1} of ${totalChunks}...` 
      });

      try {
        const translatedChunk = await translateBatch(chunk);
        chunk.forEach((original, index) => {
          this.translationMap.set(original, translatedChunk[index]);
        });
      } catch (e) {
        console.error(`Error translating batch ${i}:`, e);
        // Throw the error to stop processing if it's a critical API error
        throw e;
      }

      // Increase delay to 10 seconds to strictly respect the 15 RPM limit 
      // and allow buffer for other requests.
      if (i < totalChunks - 1) {
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  applyTranslations(): void {
    // Logic moved to getDownloadBuffer
  }

  async getDownloadBuffer(): Promise<ArrayBuffer> {
    if (!this.zip) {
        throw new Error("No file loaded");
    }

    const processFilePromises: Promise<void>[] = [];

    // 1. Process Shared Strings
    const sharedStringsFile = this.zip.file('xl/sharedStrings.xml');
    if (sharedStringsFile) {
        processFilePromises.push((async () => {
            const xml = await sharedStringsFile.async('string');
            const newXml = this.replaceSharedStrings(xml);
            if (xml !== newXml) {
                this.zip!.file('xl/sharedStrings.xml', newXml);
            }
        })());
    }

    // 2. Process Worksheets (Inline Strings)
    this.zip.forEach((path, file) => {
        if (path.match(/xl\/worksheets\/sheet.*\.xml/)) {
            processFilePromises.push((async () => {
                const xml = await file.async('string');
                // Replace standard <t> tags
                const newXml = this.replaceTagContent(xml, 't');
                if (xml !== newXml) {
                    this.zip!.file(path, newXml);
                }
            })());
        }
    });

    // 3. Process Drawings
    this.zip.forEach((path, file) => {
        if (path.match(/xl\/drawings\/drawing.*\.xml/)) {
            processFilePromises.push((async () => {
                const xml = await file.async('string');
                // Replace <a:t> tags
                const newXml = this.replaceTagContent(xml, 'a:t');
                if (xml !== newXml) {
                    this.zip!.file(path, newXml);
                }
            })());
        }
    });

    // 4. Process Charts
    this.zip.forEach((path, file) => {
        if (path.match(/xl\/charts\/chart.*\.xml/)) {
            processFilePromises.push((async () => {
                const xml = await file.async('string');
                const newXml = this.replaceTagContent(xml, 'a:t');
                if (xml !== newXml) {
                    this.zip!.file(path, newXml);
                }
            })());
        }
    });

    // 5. Process Workbook (Sheet Names)
    const workbookFile = this.zip.file('xl/workbook.xml');
    if (workbookFile) {
        processFilePromises.push((async () => {
            const xml = await workbookFile.async('string');
            const newXml = this.replaceSheetNames(xml);
            if (xml !== newXml) {
                this.zip!.file('xl/workbook.xml', newXml);
            }
        })());
    }

    await Promise.all(processFilePromises);
    return await this.zip.generateAsync({ type: "arraybuffer" });
  }

  // --- XML Replacement Helpers ---

  private replaceSharedStrings(xml: string): string {
    return xml.replace(/<si>([\s\S]*?)<\/si>/g, (match, innerContent) => {
        const cleanContent = innerContent.replace(/<rPh>[\s\S]*?<\/rPh>/g, '');
        let fullText = '';
        const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
        let tMatch;
        while ((tMatch = tRegex.exec(cleanContent)) !== null) {
            fullText += tMatch[1];
        }

        const decodedKey = this.decodeXml(fullText);

        if (this.translationMap.has(decodedKey)) {
            const translated = this.translationMap.get(decodedKey)!;
            return `<si><t>${this.escapeXml(translated)}</t></si>`;
        }
        return match;
    });
  }

  private replaceTagContent(xml: string, tagName: string): string {
     const regex = new RegExp(`(<${tagName}(?:\\s[^>]*)?>)([\\s\\S]*?)<\\/${tagName}>`, 'g');
     
     return xml.replace(regex, (match, openTag, innerContent) => {
         const decodedKey = this.decodeXml(innerContent);
         if (this.translationMap.has(decodedKey)) {
             return `${openTag}${this.escapeXml(this.translationMap.get(decodedKey)!)}</${tagName}>`;
         }
         return match;
     });
  }

  private replaceSheetNames(xml: string): string {
    return xml.replace(/(<sheet\s+[^>]*>)/g, (sheetTag) => {
        return sheetTag.replace(/name="([^"]+)"/, (match, originalName) => {
            const decodedKey = this.decodeXml(originalName);
            if (this.translationMap.has(decodedKey)) {
                let translated = this.translationMap.get(decodedKey)!;
                translated = translated.replace(/[\\/?*[\]:]/g, '_').substring(0, 31);
                return `name="${this.escapeXml(translated)}"`;
            }
            return match;
        });
    });
  }

  private escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
        return c;
    });
  }

  private decodeXml(text: string): string {
      return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&apos;/g, '\'')
        .replace(/&quot;/g, '"');
  }
}