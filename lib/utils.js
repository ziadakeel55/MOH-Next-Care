import chalk from 'chalk';

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return sleep(delay);
}

export const log = {
    info: (msg) => console.log(chalk.blue('ℹ') + ' ' + msg),
    success: (msg) => console.log(chalk.green('✔') + ' ' + msg),
    warn: (msg) => console.log(chalk.yellow('⚠') + ' ' + msg),
    error: (msg) => console.log(chalk.red('✖') + ' ' + msg),
    step: (msg) => console.log(chalk.cyan('➤') + ' ' + chalk.bold(msg)),
    data: (key, value) => console.log(chalk.gray(`  ${key}:`) + ' ' + chalk.white(value))
};

// Helper to map API item to PDF fields
export function mapItemToPdfData(item) {
    return {
        patientname: item.patientName || item.name || "Unknown",
        referralnumber: item.referralId || item.id || "0000",
        doctorname: item.doctorName || "Doctor",
        nationality: item.nationality || "",
        Medicalfilenumber: item.fileNumber || "",
        proofnumber: item.nationalId || item.iqama || "",
        hospital: item.hospitalName || "",
        section: item.specialty || "",
        gregoriandate: new Date().toLocaleDateString('en-GB'),
        date: new Date().toLocaleDateString('en-GB'),
    };
}

// Helper for MM:SS
export function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}
