const fs = require("fs");

// ============================================================
// Business Policy Constants
// ============================================================
const DELIVERY_START_SECONDS = 8 * 3600;
const DELIVERY_END_SECONDS = 22 * 3600;

const NORMAL_QUOTA_SECONDS = 8 * 3600 + 24 * 60;
const EID_QUOTA_SECONDS = 6 * 3600;

const TIER_ALLOWANCE_HOURS = {
    1: 50,
    2: 20,
    3: 10,
    4: 3
};
// ============================================================
// Time Utility Helpers
// ============================================================
function parseTime12(timeStr) {

    let [time, period] = timeStr.split(" ");
    let [h, m, s] = time.split(":").map(Number);

    if (period === "pm" && h !== 12) h += 12;
    if (period === "am" && h === 12) h = 0;

    return h * 3600 + m * 60 + s;
}
function parseDuration(timeStr) {

    let [h, m, s] = timeStr.split(":").map(Number);

    return h * 3600 + m * 60 + s;
}
function formatDuration(seconds) {

    let h = Math.floor(seconds / 3600);
    let m = Math.floor((seconds % 3600) / 60);
    let s = seconds % 60;

    return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
// ============================================================
// Domain Logic Helpers
// ============================================================
function getMonth(date) {

    return parseInt(date.split("-")[1]);
}

function isEid(date) {

    return date >= "2025-04-10" && date <= "2025-04-30";
}

function getQuotaSeconds(date) {

    return isEid(date) ? EID_QUOTA_SECONDS : NORMAL_QUOTA_SECONDS;
}
// ============================================================
// File Helpers
// ============================================================
function readFileLines(filePath) {

    return fs.readFileSync(filePath, "utf8").trim().split("\n");
}

function parseShiftLine(line) {

    let cols = line.split(",");

    return {
        driverID: cols[0],
        driverName: cols[1],
        date: cols[2],
        startTime: cols[3],
        endTime: cols[4],
        shiftDuration: cols[5],
        idleTime: cols[6],
        activeTime: cols[7],
        metQuota: cols[8] === "true",
        hasBonus: cols[9] === "true"
    };
}

function shiftObjectToLine(shiftObj) {

    return [
        shiftObj.driverID,
        shiftObj.driverName,
        shiftObj.date,
        shiftObj.startTime,
        shiftObj.endTime,
        shiftObj.shiftDuration,
        shiftObj.idleTime,
        shiftObj.activeTime,
        String(shiftObj.metQuota),
        String(shiftObj.hasBonus)
    ].join(",");
}

function parseRateLine(line) {

    let cols = line.split(",");

    return {
        driverID: cols[0].trim(),
        dayOff: cols[1].trim(),
        basePay: parseInt(cols[2].trim()),
        tier: parseInt(cols[3].trim())
    };
}

// ============================================================
// Function 1: getShiftDuration(startTime, endTime)
// startTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// endTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// Returns: string formatted as h:mm:ss
// ============================================================
function getShiftDuration(startTime, endTime) {
    const startSeconds = parseTime12(startTime);
    const endSeconds = parseTime12(endTime);
    let durationSeconds = endSeconds - startSeconds;
    if (durationSeconds < 0) durationSeconds += 86400;
    return formatDuration(durationSeconds);
}

// ============================================================
// Function 2: getIdleTime(startTime, endTime)
// startTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// endTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// Returns: string formatted as h:mm:ss
// ============================================================
function getIdleTime(startTime, endTime) {

    let startSeconds = parseTime12(startTime);
    let endSeconds = parseTime12(endTime);

    let idleSeconds = 0;

    if (startSeconds < DELIVERY_START_SECONDS) {
        idleSeconds += DELIVERY_START_SECONDS - startSeconds;
    }

    if (endSeconds > DELIVERY_END_SECONDS) {
        idleSeconds += endSeconds - DELIVERY_END_SECONDS;
    }

    return formatDuration(idleSeconds);
}

// ============================================================
// Function 3: getActiveTime(shiftDuration, idleTime)
// shiftDuration: (typeof string) formatted as h:mm:ss
// idleTime: (typeof string) formatted as h:mm:ss
// Returns: string formatted as h:mm:ss
// ============================================================
function getActiveTime(shiftDuration, idleTime) {

    let shiftSeconds = parseDuration(shiftDuration);
    let idleSeconds = parseDuration(idleTime);

    let activeSeconds = shiftSeconds - idleSeconds;

    return formatDuration(activeSeconds);
}

// ============================================================
// Function 4: metQuota(date, activeTime)
// date: (typeof string) formatted as yyyy-mm-dd
// activeTime: (typeof string) formatted as h:mm:ss
// Returns: boolean
// ============================================================
function metQuota(date, activeTime) {

    let activeSeconds = parseDuration(activeTime);

    let quotaSeconds = getQuotaSeconds(date);

    return activeSeconds >= quotaSeconds;
}

// ============================================================
// Function 5: addShiftRecord(textFile, shiftObj)
// textFile: (typeof string) path to shifts text file
// shiftObj: (typeof object) has driverID, driverName, date, startTime, endTime
// Returns: object with 10 properties or empty object {}
// ============================================================
function addShiftRecord(textFile, shiftObj) {

    let lines = readFileLines(textFile);
    let header = lines[0];
    let rows = lines.slice(1);

    let parsed = rows.map(parseShiftLine);

    for (let r of parsed) {
        if (r.driverID === shiftObj.driverID && r.date === shiftObj.date) {
            return {};
        }
    }

    let shiftDuration = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
    let idleTime = getIdleTime(shiftObj.startTime, shiftObj.endTime);
    let activeTime = getActiveTime(shiftDuration, idleTime);
    let quota = metQuota(shiftObj.date, activeTime);

    let record = {
        driverID: shiftObj.driverID,
        driverName: shiftObj.driverName,
        date: shiftObj.date,
        startTime: shiftObj.startTime,
        endTime: shiftObj.endTime,
        shiftDuration: shiftDuration,
        idleTime: idleTime,
        activeTime: activeTime,
        metQuota: quota,
        hasBonus: false
    };

    let insertIndex = rows.length;

    for (let i = 0; i < parsed.length; i++) {
        if (parsed[i].driverID === shiftObj.driverID) {
            insertIndex = i + 1;
        }
    }

    rows.splice(insertIndex, 0, shiftObjectToLine(record));

    fs.writeFileSync(textFile, header + "\n" + rows.join("\n"));

    return record;
}

// ============================================================
// Function 6: setBonus(textFile, driverID, date, newValue)
// textFile: (typeof string) path to shifts text file
// driverID: (typeof string)
// date: (typeof string) formatted as yyyy-mm-dd
// newValue: (typeof boolean)
// Returns: nothing (void)
// ============================================================
function setBonus(textFile, driverID, date, newValue) {

    let lines = readFileLines(textFile);
    let header = lines[0];
    let rows = lines.slice(1);

    rows = rows.map(r => {

        let cols = r.split(",");

        if (cols[0] === driverID && cols[2] === date) {
            cols[9] = String(newValue);
        }

        return cols.join(",");
    });

    fs.writeFileSync(textFile, header + "\n" + rows.join("\n"));
}

// ============================================================
// Function 7: countBonusPerMonth(textFile, driverID, month)
// textFile: (typeof string) path to shifts text file
// driverID: (typeof string)
// month: (typeof string) formatted as mm or m
// Returns: number (-1 if driverID not found)
// ============================================================
function countBonusPerMonth(textFile, driverID, month) {

    let rows = readFileLines(textFile).slice(1);

    month = parseInt(month);

    let found = false;
    let count = 0;

    for (let r of rows) {

        let shift = parseShiftLine(r);

        if (shift.driverID === driverID) {

            found = true;

            if (getMonth(shift.date) === month && shift.hasBonus) {
                count++;
            }
        }
    }

    if (!found) return -1;

    return count;
}

// ============================================================
// Function 8: getTotalActiveHoursPerMonth(textFile, driverID, month)
// textFile: (typeof string) path to shifts text file
// driverID: (typeof string)
// month: (typeof number)
// Returns: string formatted as hhh:mm:ss
// ============================================================
function getTotalActiveHoursPerMonth(textFile, driverID, month) {

    let rows = readFileLines(textFile).slice(1);

    let totalSeconds = 0;

    for (let r of rows) {

        let shift = parseShiftLine(r);

        if (shift.driverID === driverID && getMonth(shift.date) === month) {

            totalSeconds += parseDuration(shift.activeTime);
        }
    }

    return formatDuration(totalSeconds);
}

// ============================================================
// Function 9: getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month)
// textFile: (typeof string) path to shifts text file
// rateFile: (typeof string) path to driver rates text file
// bonusCount: (typeof number) total bonuses for given driver per month
// driverID: (typeof string)
// month: (typeof number)
// Returns: string formatted as hhh:mm:ss
// ============================================================
function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {

    let rows = readFileLines(textFile).slice(1);

    let totalSeconds = 0;

    for (let r of rows) {

        let shift = parseShiftLine(r);

        if (shift.driverID === driverID && getMonth(shift.date) === month) {

            totalSeconds += getQuotaSeconds(shift.date);
        }
    }

    totalSeconds -= bonusCount * 2 * 3600;

    return formatDuration(totalSeconds);
}

// ============================================================
// Function 10: getNetPay(driverID, actualHours, requiredHours, rateFile)
// driverID: (typeof string)
// actualHours: (typeof string) formatted as hhh:mm:ss
// requiredHours: (typeof string) formatted as hhh:mm:ss
// rateFile: (typeof string) path to driver rates text file
// Returns: integer (net pay)
// ============================================================
function getNetPay(driverID, actualHours, requiredHours, rateFile) {

    let lines = readFileLines(rateFile);

    let basePay = null;
    let tier = null;

    for (let line of lines) {

        let rate = parseRateLine(line);

        if (rate.driverID === driverID) {
            basePay = rate.basePay;
            tier = rate.tier;
            break;
        }
    }

    if (basePay === null) return null;

    let actual = parseDuration(actualHours);
    let required = parseDuration(requiredHours);

    if (actual >= required) return basePay;

    let missingHours = Math.floor((required - actual) / 3600);

    let allowance = TIER_ALLOWANCE_HOURS[tier];

    if (missingHours <= allowance) return basePay;

    let billable = missingHours - allowance;

    let deductionRate = Math.floor(basePay / 185);

    let deduction = billable * deductionRate;

    return basePay - deduction;
}

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};
