import { PDFDocument, rgb } from 'pdf-lib';
import * as fontkit from 'fontkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const TEMPLATE_PATH = path.join(ASSETS_DIR, 'template.pdf');
const FONT_PATH = path.join(ASSETS_DIR, 'ar.ttf');

function cleanPatientName(rawName) {
    if (!rawName) return "";
    // Logic from report.js
    const fromSplit = rawName.split(/\bFrom\s*:/i);
    let nameOnly = fromSplit[0].trim();

    const separators = ["...", "Diagnosis:", "Medical Brief", "Sender", "Patient ID", "|", "Referral ID", "LTC patient", "Ehality", "ID#"];
    const pattern = new RegExp(`(${separators.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');

    return nameOnly.split(pattern)[0].trim().replace(/\s+/g, ' ');
}

function extractHospitalName(rawName) {
    if (!rawName) return "";
    const fromMatch = rawName.match(/\bFrom\s*:\s*(.+)/i);
    if (fromMatch) {
        let hospitalName = fromMatch[1].trim();
        const separators = ["...", "Diagnosis:", "Medical Brief", "Sender", "Patient ID", "|", "Referral ID", "LTC patient", "Ehality", "ID#"];
        const pattern = new RegExp(`(${separators.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
        return hospitalName.split(pattern)[0].trim();
    }
    return "";
}

export async function generateReport(outputName = null, inputData = {}) {
    log.step('Generating PDF Report...');

    // Ensure reports directory exists
    const REPORTS_DIR = path.resolve(process.cwd(), 'reports');
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR);

    // 1. Determine Filename
    let finalPath;
    if (outputName && outputName.includes('/') || outputName && outputName.includes('\\')) {
        // It's a path, use it as is
        finalPath = outputName;
    } else {
        // Construct filename based on patient Name
        const safeName = (inputData.patientname || "Unknown_Patient")
            .replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_') // Keep Arabic & English & nums
            .replace(/_+/g, '_'); // Dedup underscores

        const filename = outputName || `Acceptance_${safeName}.pdf`;
        finalPath = path.join(REPORTS_DIR, filename);
    }

    if (!fs.existsSync(TEMPLATE_PATH)) {
        throw new Error('Template PDF missing in assets folder!');
    }

    try {
        const existingPdfBytes = fs.readFileSync(TEMPLATE_PATH);
        const pdfDoc = await PDFDocument.load(existingPdfBytes);

        // Register fontkit
        pdfDoc.registerFontkit(fontkit);

        const form = pdfDoc.getForm();

        // 2. Prepare Data
        let data = { ...inputData };

        if (data.patientname) {
            data.patientname = cleanPatientName(data.patientname);
            if (!data.hospitaldirectorname && !data.hospital) {
                const extractedHosp = extractHospitalName(inputData.patientname);
                if (extractedHosp) data.hospitaldirectorname = extractedHosp;
            }
        }

        // 3. Load Arabic Font (Auto-Subsetted by pdf-lib + fontkit)
        let customFont = null;
        if (fs.existsSync(FONT_PATH)) {
            const fontBytes = fs.readFileSync(FONT_PATH);
            try {
                // pdf-lib with fontkit auto-subsets: only glyphs used in the doc are embedded
                // This reduces ar.ttf from ~1MB to just a few KB in the final PDF
                customFont = await pdfDoc.embedFont(fontBytes, { subset: false });
                log.info("Arabic font loaded (auto-subset enabled).");
            } catch (fontErr) {
                log.warn(`Font embed failed (${fontErr.message}), trying full embed.`);
                try { customFont = await pdfDoc.embedFont(fontBytes); } catch (_) { }
            }
        } else {
            log.warn('ar.ttf font missing! Arabic text will be skipped.');
        }

        // 4. Fill Fields
        for (const [key, value] of Object.entries(data)) {
            if (!value) continue;
            const fieldValue = String(value);

            try {
                let field;
                try { field = form.getTextField(key); } catch (e) { }

                if (field) {
                    if (/[\u0600-\u06FF]/.test(fieldValue)) {
                        if (customFont) {
                            try {
                                const widgets = field.acroField.getWidgets();
                                widgets.forEach(widget => {
                                    const rect = widget.getRectangle();
                                    const page = pdfDoc.getPages()[0];
                                    const fontSize = 10;
                                    const textWidth = customFont.widthOfTextAtSize(fieldValue, fontSize);
                                    page.drawText(fieldValue, {
                                        x: rect.x + (rect.width - textWidth) / 2,
                                        y: rect.y + 3,
                                        size: fontSize,
                                        font: customFont,
                                        color: rgb(0, 0, 0)
                                    });
                                });
                                field.setText("");
                            } catch (drawErr) {
                                field.setText("");
                            }
                        } else {
                            field.setText("");
                        }
                    } else {
                        field.setText(fieldValue);
                    }
                }
            } catch (e) { }
        }

        try { form.flatten(); } catch (_) { }

        // 5. Save — maximum compression, no metadata bloat
        const pdfBytes = await pdfDoc.save({
            useObjectStreams: true,
            addDefaultPage: false
        });
        fs.writeFileSync(finalPath, pdfBytes);

        const sizes = (pdfBytes.length / 1024).toFixed(2);
        log.success(`PDF Generated: ${finalPath} (${sizes} KB)`);
        return finalPath;

    } catch (e) {
        log.error('PDF Generation Error: ' + e.message);
        throw e;
    }
}
