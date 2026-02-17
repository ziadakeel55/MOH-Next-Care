import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- DATA ENRICHMENT HELPER ---
function getAppDefaults() {
    try {
        const dataConfigPath = path.join(__dirname, '..', 'data', 'app_defaults.json');
        if (fs.existsSync(dataConfigPath)) {
            return JSON.parse(fs.readFileSync(dataConfigPath, 'utf8'));
        }
    } catch (e) {
        // Silent fail or log if logger available
    }
    return { defaults: {}, options: {} };
}

export function enrichMockData(item) {
    const config = getAppDefaults();
    const defaults = config.defaults || {};

    // Always use TODAY for dates
    const todayStr = new Date().toLocaleDateString('en-GB');

    // Helper to pick first option if available
    const pickOption = (key) => {
        if (config.options && config.options[key] && config.options[key].length > 0) {
            return config.options[key][0];
        }
        return "";
    };

    // Referral number logic (matches V1.6):
    // If referralReferenceId exists, use it as display referral number
    // and use referralId as medical file number
    const hasRefRef = item.referralReferenceId && String(item.referralReferenceId).trim() !== '';
    const hasRefId = item.referralId && String(item.referralId).trim() !== '';
    const displayReferralNumber = hasRefRef ? item.referralReferenceId : (item.referralId || "");
    const medicalFileNumber = (hasRefRef && hasRefId) ? item.referralId : (defaults.medicalfilenumber || "");

    // Date formatting from createdAt (e.g. "2025-01-15" → "15/01/2025")
    let referralDateStr = todayStr;
    if (item.createdAt) {
        const datePart = item.createdAt.split(' ')[0]; // YYYY-MM-DD
        if (datePart && datePart.includes('-')) {
            const [y, m, d] = datePart.split('-');
            referralDateStr = `${d}/${m}/${y}`;
        }
    }

    return {
        // 1. Patient Info (from API case data)
        patientname: item.patientName || "Unknown Patient",
        proofnumber: item.patientNationalId || item.nationalId || defaults.proofnumber || "",
        nationality: item.patientNationality || item.nationality || defaults.nationality || pickOption('nationality') || "Saudi",
        Medicalfilenumber: medicalFileNumber,

        // 2. Doctor/Hospital Info (API + defaults)
        doctorname: item.doctorName || defaults.doctorname || pickOption('doctorname') || "",
        hospitaldirector: defaults.hospitaldirector || "",
        hospitaldirectorname: item.providerName || defaults.hospitaldirectorname || defaults.hospitaldirector || "",

        // 3. Location Info (from defaults)
        roomnumber: defaults.roomnumber || "5",
        bednumber: defaults.bednumber || "1",
        section: item.mainSpecialty || defaults.section || pickOption('section') || "",
        hospital: item.hospitalName || "",

        // 4. Referral Info (from API case data)
        referralnumber: displayReferralNumber,
        referraldate: referralDateStr,
        bookingperiod: defaults.bookingperiod || "24h",
        sendername: defaults.sendername || "",

        // 5. Staff Info (from defaults)
        employeename: defaults.employeename || "",
        telephone: defaults.telephone || "",

        // 6. Dates (enforced TODAY)
        gregoriandate: todayStr,
        date: todayStr
    };
}

// --- CUSTOM DIAGNOSIS REVIEW (SIMULATION STYLE) ---
export async function reviewDiagnosisData(initialData) {
    console.log(chalk.bold.cyan("\n📋 DIAGNOSIS DATA REVIEW"));
    console.log(chalk.gray("Directly edit fields. Press ENTER to accept defaults.\n"));

    const config = getAppDefaults();
    const optionsMap = config.options || {};

    // Enrich first to ensure defaults are populated
    let data = enrichMockData(initialData);

    const FIELDS = [
        { key: 'patientname', label: 'Patient Name' },
        { key: 'proofnumber', label: 'Proof Number (National ID)' },
        { key: 'nationality', label: 'Nationality', hasOptions: true },
        { key: 'doctorname', label: 'Doctor Name', hasOptions: true },
        { key: 'Medicalfilenumber', label: 'Medical File Number' },
        { key: 'roomnumber', label: 'Room Number' },
        { key: 'bednumber', label: 'Bed Number' },
        { key: 'bookingperiod', label: 'Booking Period' },
        { key: 'section', label: 'Section', hasOptions: true },
        { key: 'gregoriandate', label: 'Gregorian Date' },
        { key: 'referraldate', label: 'Referral Date' },
        { key: 'referralnumber', label: 'Referral Number' },
        { key: 'sendername', label: 'Sender Name' },
        { key: 'hospitaldirector', label: 'Hospital Director' },
        { key: 'hospitaldirectorname', label: 'Director Name (Signature)' },
        { key: 'employeename', label: 'Employee Name' },
        { key: 'telephone', label: 'Telephone' },
        { key: 'date', label: 'Report Date' }
    ];

    for (const field of FIELDS) {
        const currentVal = data[field.key];

        if (field.hasOptions && optionsMap[field.key]) {
            // LIST SELECTION WITH "CHANGE" OPTION
            const choices = [...optionsMap[field.key]];

            // Add Separator and Change Option
            choices.push(new inquirer.Separator());
            choices.push({ name: '✏️  Change (Manual Input)', value: '__manual__' });

            // Force default to first option (Index 0) as requested
            let defaultIdx = 0;

            const { selection } = await inquirer.prompt([{
                type: 'rawlist',
                name: 'selection',
                message: `${field.label}:`,
                choices: choices,
                default: defaultIdx
            }]);

            if (selection === '__manual__') {
                const { manualVal } = await inquirer.prompt([{
                    type: 'input',
                    name: 'manualVal',
                    message: `Enter ${field.label}:`,
                    default: currentVal
                }]);
                data[field.key] = manualVal;
            } else {
                data[field.key] = selection;
            }

        } else {
            // TEXT INPUT
            const { inputVal } = await inquirer.prompt([{
                type: 'input',
                name: 'inputVal',
                message: `${field.label}:`,
                default: currentVal
            }]);
            data[field.key] = inputVal;
        }
    }

    console.log(chalk.green("\n✅ Review Complete.\n"));
    return data;
}
