const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');

const normalizeHeader = (header) => {
  const normalized = String(header || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const aliases = {
    activity_category: 'category',
    emission_category: 'category',
    emission_type: 'category',
    activity_type: 'category',
    quantity_unit: 'unit',
    activity_unit: 'unit',
    periodstart: 'period_start',
    start_date: 'period_start',
    period_start_date: 'period_start',
    periodend: 'period_end',
    end_date: 'period_end',
    period_end_date: 'period_end',
    subcategory: 'sub_category',
    emissionfactor: 'emission_factor',
  };

  if (normalized.startsWith('quantity_')) return 'quantity';
  return aliases[normalized] || normalized;
};

const normalizeValue = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return typeof value === 'string' ? value.trim() : value;
};

/**
 * Process CSV file and return rows as array of objects
 */
const processCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    const rows = [];
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream
      .pipe(csv({ mapHeaders: ({ header }) => normalizeHeader(header) }))
      .on('data', (row) => {
        const hasValues = Object.values(row).some((value) => String(value ?? '').trim() !== '');
        if (hasValues) rows.push(row);
      })
      .on('end', () => resolve(rows))
      .on('error', (err) => reject(err));
  });
};

/**
 * Process Excel file and return rows as array of objects
 */
const processExcel = (filePath) => {
  try {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    // Normalize keys
    const rows = rawRows.map((row) => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        const normalizedKey = normalizeHeader(key);
        normalized[normalizedKey] = normalizeValue(value);
      }
      return normalized;
    }).filter((row) => Object.values(row).some((value) => String(value ?? '').trim() !== ''));

    return rows;
  } catch (err) {
    throw new Error(`Excel processing failed: ${err.message}`);
  }
};

module.exports = { processCSV, processExcel };
