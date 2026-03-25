function createMonthlyLedgerSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = findSheetByName_(ss, 'sheet1');

  if (!sourceSheet) {
    throw new Error('Hindi makita ang source sheet na "sheet1".');
  }

  const values = sourceSheet.getDataRange().getValues();
  const headerInfo = findColumnIndexes_(values);

  if (!headerInfo) {
    throw new Error('Hindi makita ang required headers sa source sheet.');
  }

  const summaryRows = buildMonthlySummaryRows_(values, headerInfo);
  if (summaryRows.length === 0) {
    throw new Error('Walang valid dated transactions na pwedeng i-summarize.');
  }

  const outputName = 'Monthly Summary';
  const existingSheet = ss.getSheetByName(outputName);
  if (existingSheet) {
    ss.deleteSheet(existingSheet);
  }

  const outputSheet = ss.insertSheet(outputName);
  outputSheet.getRange(1, 1, summaryRows.length, summaryRows[0].length).setValues(summaryRows);
  formatSummarySheet_(outputSheet, summaryRows.length);
}

const MONTH_ORDER_ = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function findSheetByName_(spreadsheet, targetName) {
  const lowerTarget = String(targetName).toLowerCase();
  return spreadsheet
    .getSheets()
    .find((sheet) => sheet.getName().toLowerCase() === lowerTarget) || null;
}

function findColumnIndexes_(values) {
  let dateColumnIndex = -1;
  let debitColumnIndex = -1;
  let creditColumnIndex = -1;

  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    for (let colIndex = 0; colIndex < values[rowIndex].length; colIndex++) {
      const text = String(values[rowIndex][colIndex] || '').trim().toLowerCase();
      if (text === 'date') {
        dateColumnIndex = colIndex;
      } else if (text === 'debit') {
        debitColumnIndex = colIndex;
      } else if (text === 'credit') {
        creditColumnIndex = colIndex;
      }
    }
  }

  if (dateColumnIndex === -1 || debitColumnIndex === -1 || creditColumnIndex === -1) {
    return null;
  }

  return { dateColumnIndex, debitColumnIndex, creditColumnIndex };
}

function buildMonthlySummaryRows_(values, headerInfo) {
  const { dateColumnIndex, debitColumnIndex, creditColumnIndex } = headerInfo;
  const monthBuckets = {};
  let currentMain = '';
  let currentSub = '';

  values.forEach((row) => {
    const mainLabel = normalizeLabel_(row[1]);
    const subLabel = normalizeLabel_(row[2]);
    const dateValue = toDateSafe_(row[dateColumnIndex]);

    if (mainLabel) {
      currentMain = mainLabel;
      currentSub = '';
      return;
    }

    if (subLabel) {
      currentSub = subLabel;
      return;
    }

    if (!dateValue) {
      return;
    }

    const monthName = Utilities.formatDate(
      dateValue,
      Session.getScriptTimeZone(),
      'MMMM'
    );

    if (!monthBuckets[monthName]) {
      monthBuckets[monthName] = {};
    }

    const key = `${currentMain}|||${currentSub}`;
    if (!monthBuckets[monthName][key]) {
      monthBuckets[monthName][key] = {
        main: currentMain,
        sub: currentSub,
        debit: 0,
        credit: 0,
        count: 0,
      };
    }

    monthBuckets[monthName][key].debit += toNumberSafe_(row[debitColumnIndex]);
    monthBuckets[monthName][key].credit += toNumberSafe_(row[creditColumnIndex]);
    monthBuckets[monthName][key].count += 1;
  });

  const summaryRows = [['Month', 'Column B', 'Column C', 'Total Debit', 'Total Credit', 'Net', 'Entries']];

  MONTH_ORDER_.forEach((monthName) => {
    if (!monthBuckets[monthName]) {
      return;
    }

    summaryRows.push([monthName, '', '', '', '', '', '']);
    summaryRows.push(['', 'Column B', 'Column C', 'Total Debit', 'Total Credit', 'Net', 'Entries']);

    const monthRows = Object.values(monthBuckets[monthName]).sort(compareSummaryRows_);
    monthRows.forEach((item) => {
      summaryRows.push([
        '',
        item.main,
        item.sub,
        item.debit,
        item.credit,
        item.debit - item.credit,
        item.count,
      ]);
    });

    const monthDebit = monthRows.reduce((sum, item) => sum + item.debit, 0);
    const monthCredit = monthRows.reduce((sum, item) => sum + item.credit, 0);
    const monthEntries = monthRows.reduce((sum, item) => sum + item.count, 0);

    summaryRows.push([
      '',
      'Month Total',
      '',
      monthDebit,
      monthCredit,
      monthDebit - monthCredit,
      monthEntries,
    ]);
    summaryRows.push(['', '', '', '', '', '', '']);
  });

  return summaryRows;
}

function compareSummaryRows_(a, b) {
  if (a.main !== b.main) {
    return a.main.localeCompare(b.main);
  }
  return a.sub.localeCompare(b.sub);
}

function normalizeLabel_(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (/^total\b/i.test(text)) {
    return '';
  }
  return text;
}

function toDateSafe_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return value;
  }

  if (typeof value === 'number') {
    return new Date(Math.round((value - 25569) * 86400 * 1000));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toNumberSafe_(value) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    return cleaned ? Number(cleaned) || 0 : 0;
  }

  return 0;
}

function formatSummarySheet_(sheet, rowCount) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#d9ead3');

  for (let row = 2; row <= rowCount; row++) {
    const monthCell = sheet.getRange(row, 1).getValue();
    const labelCell = sheet.getRange(row, 2).getValue();

    if (monthCell && !labelCell) {
      sheet.getRange(row, 1, 1, 7).setFontWeight('bold').setBackground('#cfe2f3');
    } else if (!monthCell && labelCell === 'Column B') {
      sheet.getRange(row, 1, 1, 7).setFontWeight('bold').setBackground('#fce5cd');
    } else if (!monthCell && labelCell === 'Month Total') {
      sheet.getRange(row, 1, 1, 7).setFontWeight('bold').setBackground('#ead1dc');
    }
  }

  sheet.getRange(2, 4, Math.max(rowCount - 1, 1), 3).setNumberFormat('#,##0.00');
  sheet.getRange(2, 7, Math.max(rowCount - 1, 1), 1).setNumberFormat('0');
  sheet.autoResizeColumns(1, 7);
}
