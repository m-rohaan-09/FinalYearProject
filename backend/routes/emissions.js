const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { EmissionData, Company, Department, BillUpload, CompanyMember } = require('../models');
const { authenticate, authorize, requirePermission } = require('../middleware/auth');
const logAudit = require('../utils/auditLogger');
const upload = require('../middleware/upload');
const { processCSV, processExcel } = require('../utils/fileProcessors');

const router = express.Router();

router.use(authenticate);

// ─── EMISSION FACTORS (simplified defaults) ───────────
const EMISSION_FACTORS = {
  electricity: { factor: 0.716, unit: 'kgCO2e/kWh', scope: 'scope_2' },
  natural_gas: { factor: 2.02, unit: 'kgCO2e/m³', scope: 'scope_1' },
  fuel: { factor: 2.31, unit: 'kgCO2e/litre', scope: 'scope_1' },
  water: { factor: 0.344, unit: 'kgCO2e/m³', scope: 'scope_3' },
  waste: { factor: 0.467, unit: 'kgCO2e/kg', scope: 'scope_3' },
  transport: { factor: 0.171, unit: 'kgCO2e/km', scope: 'scope_1' },
  refrigerants: { factor: 1810, unit: 'kgCO2e/kg', scope: 'scope_1' },
  other: { factor: 1.0, unit: 'kgCO2e/unit', scope: 'scope_3' },
};

// ─── MANUAL DATA ENTRY ────────────────────────────────
router.post(
  '/manual',
  authorize('company_rep', 'admin', 'auditor'),
  [
    body('companyId').isInt(),
    body('departmentId').optional({ nullable: true }).isInt(),
    body('category').isIn(Object.keys(EMISSION_FACTORS)),
    body('subCategory').optional().trim(),
    body('quantity').isFloat({ min: 0 }),
    body('unit').trim().notEmpty(),
    body('periodStart').isDate(),
    body('periodEnd').isDate(),
    body('notes').optional().trim(),
    body('emissionFactor').optional().isFloat({ min: 0 }),
    body('scope').optional().isIn(['scope_1', 'scope_2', 'scope_3']),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
      }

      const { companyId, departmentId, category, subCategory, quantity, unit, periodStart, periodEnd, notes, emissionFactor, scope } = req.body;

      // Verify ownership or role-based access
      const company = await Company.findByPk(companyId);
      if (!company) return res.status(404).json({ message: 'Company not found' });

      const membership = await CompanyMember.findOne({
        where: { companyId, userId: req.user.id, status: 'active' },
      });
      const hasCompanyAccess =
        company.ownerId === req.user.id ||
        req.user.role === 'admin' ||
        (membership && (membership.role === 'company_rep' || membership.role === 'auditor'));

      if (!hasCompanyAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const defaultFactor = EMISSION_FACTORS[category];
      const usedFactor = emissionFactor || defaultFactor.factor;
      const usedScope = scope || defaultFactor.scope;
      const co2Equivalent = quantity * usedFactor;

      const record = await EmissionData.create({
        companyId,
        departmentId: departmentId || null,
        category,
        subCategory,
        scope: usedScope,
        quantity,
        unit,
        emissionFactor: usedFactor,
        emissionFactorUnit: defaultFactor.unit,
        co2Equivalent,
        periodStart,
        periodEnd,
        source: 'manual',
        notes,
        enteredById: req.user.id,
      });

      await logAudit({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'CREATE_EMISSION_DATA',
        resource: 'emission_data',
        resourceId: record.id,
        details: { category, quantity, co2Equivalent, source: 'manual' },
        req,
      });

      res.status(201).json({ message: 'Emission data recorded', record });
    } catch (err) {
      console.error('Manual entry error:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// ─── UPLOAD CSV/EXCEL ─────────────────────────────────
router.post(
  '/upload',
  authorize('company_rep', 'admin', 'auditor'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const { companyId, departmentId } = req.body;
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID is required' });
      }

      const company = await Company.findByPk(companyId);
      if (!company) return res.status(404).json({ message: 'Company not found' });

      const membership = await CompanyMember.findOne({
        where: { companyId: parseInt(companyId), userId: req.user.id, status: 'active' },
      });
      const hasCompanyAccess =
        company.ownerId === req.user.id ||
        req.user.role === 'admin' ||
        (membership && (membership.role === 'company_rep' || membership.role === 'auditor'));

      if (!hasCompanyAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const ext = req.file.originalname.split('.').pop().toLowerCase();
      let fileType;
      if (ext === 'csv') fileType = 'csv';
      else if (['xlsx', 'xls'].includes(ext)) fileType = 'excel';
      else return res.status(400).json({ message: 'Unsupported file format' });

      const billUpload = await BillUpload.create({
        companyId: parseInt(companyId),
        departmentId: departmentId ? parseInt(departmentId) : null,
        fileName: req.file.filename,
        originalName: req.file.originalname,
        fileType,
        filePath: req.file.path,
        fileSize: req.file.size,
        status: 'processing',
        uploadedById: req.user.id,
      });

      try {
        let rows;
        if (fileType === 'csv') {
          rows = await processCSV(req.file.path);
        } else {
          rows = await processExcel(req.file.path);
        }

        if (rows.length === 0) {
          throw new Error('The file contains no data rows.');
        }

        const requiredColumns = ['category', 'quantity', 'unit', 'period_start', 'period_end'];
        const missingColumns = requiredColumns.filter(
          (column) => !Object.prototype.hasOwnProperty.call(rows[0], column)
        );
        if (missingColumns.length > 0) {
          throw new Error(`Missing required column${missingColumns.length > 1 ? 's' : ''}: ${missingColumns.join(', ')}.`);
        }

        let importedCount = 0;
        const errors = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          try {
            const normalizedCategory = (row.category || '')
              .toLowerCase()
              .trim()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '');
            const categoryAliases = { fuel_diesel_petrol: 'fuel' };
            const category = categoryAliases[normalizedCategory] || normalizedCategory;
            if (!EMISSION_FACTORS[category]) {
              errors.push(`Row ${i + 2}: Unknown category "${row.category}"`);
              continue;
            }

            const parseNumber = (value) => {
              const normalized = String(value ?? '').trim().replace(/,/g, '');
              return normalized ? Number(normalized) : NaN;
            };
            const quantity = parseNumber(row.quantity);
            if (!Number.isFinite(quantity) || quantity < 0) {
              errors.push(`Row ${i + 2}: Invalid quantity`);
              continue;
            }

            if (!String(row.unit || '').trim()) {
              errors.push(`Row ${i + 2}: Unit is missing`);
              continue;
            }

            const periodStart = row.period_start;
            const periodEnd = row.period_end;
            if (!periodStart || !periodEnd) {
              errors.push(`Row ${i + 2}: Period start or period end is missing.`);
              continue;
            }

            const defaultFactor = EMISSION_FACTORS[category];
            const factor = row.emission_factor === undefined || String(row.emission_factor).trim() === ''
              ? defaultFactor.factor
              : parseNumber(row.emission_factor);
            if (!Number.isFinite(factor) || factor < 0) {
              errors.push(`Row ${i + 2}: Invalid emission factor`);
              continue;
            }

            const scopeValue = (row.scope || defaultFactor.scope)
              .toLowerCase()
              .trim()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '');
            if (!['scope_1', 'scope_2', 'scope_3'].includes(scopeValue)) {
              errors.push(`Row ${i + 2}: Invalid scope "${row.scope}"`);
              continue;
            }
            const scope = scopeValue;

            await EmissionData.create({
              companyId: parseInt(companyId),
              departmentId: departmentId ? parseInt(departmentId) : null,
              category,
              subCategory: row.sub_category || null,
              scope,
              quantity,
              unit: String(row.unit).trim(),
              emissionFactor: factor,
              emissionFactorUnit: defaultFactor.unit,
              co2Equivalent: quantity * factor,
              periodStart,
              periodEnd,
              source: fileType === 'csv' ? 'csv_upload' : 'excel_upload',
              billUploadId: billUpload.id,
              notes: row.notes || null,
              enteredById: req.user.id,
            });
            importedCount++;
          } catch (rowErr) {
            errors.push(`Row ${i + 2}: ${rowErr.message}`);
          }
        }

        await billUpload.update({
          status: errors.length > 0 && importedCount === 0 ? 'failed' : 'completed',
          recordsImported: importedCount,
          extractedData: JSON.stringify(rows.slice(0, 5)),
          errorLog: errors.length > 0 ? JSON.stringify(errors) : null,
        });

        await logAudit({
          userId: req.user.id,
          userEmail: req.user.email,
          action: 'UPLOAD_DATA_FILE',
          resource: 'bill_uploads',
          resourceId: billUpload.id,
          details: { fileName: req.file.originalname, importedCount, errors: errors.length },
          req,
        });

        const response = {
          message: `File processed: ${importedCount} records imported`,
          billUpload,
          importedCount,
          errors,
        };
        if (importedCount === 0) {
          return res.status(422).json({ ...response, message: 'No records could be imported.' });
        }
        res.json(response);
      } catch (processErr) {
        await billUpload.update({ status: 'failed', errorLog: processErr.message });
        res.status(422).json({ message: 'File processing failed', error: processErr.message });
      }
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// ─── GET EMISSION DATA FOR COMPANY ────────────────────
router.get('/', async (req, res) => {
  try {
    const { companyId, category, scope, source, departmentId, periodStart, periodEnd } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    if (!companyId) {
      return res.status(400).json({ message: 'Company ID is required' });
    }

    const company = await Company.findByPk(parseInt(companyId));
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const membership = await CompanyMember.findOne({
      where: { companyId: parseInt(companyId), userId: req.user.id, status: 'active' },
    });
    const hasAccess =
      company.ownerId === req.user.id ||
      req.user.role === 'admin' ||
      (membership && ['company_rep', 'employee', 'auditor'].includes(membership.role));

    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const where = { companyId: parseInt(companyId) };
    if (category) where.category = category;
    if (scope) where.scope = scope;
    if (source) where.source = source;
    if (departmentId) where.departmentId = parseInt(departmentId);
    if (periodStart && periodEnd) {
      where.periodStart = { [Op.gte]: periodStart };
      where.periodEnd = { [Op.lte]: periodEnd };
    }

    const { count, rows } = await EmissionData.findAndCountAll({
      where,
      order: [['periodStart', 'DESC']],
      limit,
      offset,
      include: [
        { model: Department, as: 'department', attributes: ['id', 'name'] },
      ],
    });

    res.json({
      records: rows,
      pagination: { total: count, page, pages: Math.ceil(count / limit), limit },
    });
  } catch (err) {
    console.error('Get emission data error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── DELETE EMISSION RECORD ───────────────────────────
router.delete('/:id', authorize('company_rep', 'admin', 'auditor'), async (req, res) => {
  try {
    const record = await EmissionData.findByPk(req.params.id, {
      include: [{ model: Company, as: 'company' }],
    });
    if (!record) return res.status(404).json({ message: 'Record not found' });

    const membership = await CompanyMember.findOne({
      where: { companyId: record.companyId, userId: req.user.id, status: 'active' },
    });
    const hasCompanyAccess =
      record.company.ownerId === req.user.id ||
      req.user.role === 'admin' ||
      (membership && (membership.role === 'company_rep' || membership.role === 'auditor'));

    if (!hasCompanyAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'DELETE_EMISSION_DATA',
      resource: 'emission_data',
      resourceId: record.id,
      details: { category: record.category, quantity: record.quantity },
      req,
    });

    await record.destroy();
    res.json({ message: 'Record deleted' });
  } catch (err) {
    console.error('Delete emission data error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET UPLOAD HISTORY ───────────────────────────────
router.get('/uploads', async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ message: 'Company ID is required' });

    const company = await Company.findByPk(parseInt(companyId));
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const membership = await CompanyMember.findOne({
      where: { companyId: parseInt(companyId), userId: req.user.id, status: 'active' },
    });
    const hasAccess =
      company.ownerId === req.user.id ||
      req.user.role === 'admin' ||
      (membership && ['company_rep', 'employee', 'auditor'].includes(membership.role));

    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const uploads = await BillUpload.findAll({
      where: { companyId: parseInt(companyId) },
      order: [['createdAt', 'DESC']],
    });

    res.json({ uploads });
  } catch (err) {
    console.error('Get uploads error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// ─── EXPORT EMISSION DATA (CSV) ───────────────────────
router.get('/export', requirePermission('exportCarbonFootprintData'), async (req, res) => {
  try {
    const { companyId, category, scope, departmentId, periodStart, periodEnd } = req.query;
    if (!companyId) return res.status(400).json({ message: 'Company ID is required' });

    const company = await Company.findByPk(parseInt(companyId));
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const membership = await CompanyMember.findOne({ where: { companyId: parseInt(companyId), userId: req.user.id, status: 'active' } });
    const hasAccess = company.ownerId === req.user.id || req.user.role === 'admin' || (membership && ['company_rep', 'auditor'].includes(membership.role));
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const where = { companyId: parseInt(companyId) };
    if (category) where.category = category;
    if (scope) where.scope = scope;
    if (departmentId) where.departmentId = parseInt(departmentId);
    if (periodStart && periodEnd) {
      where.periodStart = { [Op.gte]: periodStart };
      where.periodEnd = { [Op.lte]: periodEnd };
    }

    const records = await EmissionData.findAll({ where, include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }] });

    // Build CSV
    const cols = ['id','periodStart','periodEnd','category','subCategory','quantity','unit','emissionFactor','co2Equivalent','scope','department','source','enteredById','createdAt'];
    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };

    let csv = cols.join(',') + '\n';
    for (const r of records) {
      const row = [
        r.id,
        r.periodStart,
        r.periodEnd,
        r.category,
        r.subCategory || '',
        r.quantity,
        r.unit,
        r.emissionFactor,
        r.co2Equivalent,
        r.scope,
        r.department?.name || '',
        r.source,
        r.enteredById,
        r.createdAt,
      ].map(escape).join(',');
      csv += row + '\n';
    }

    await logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'EXPORT_EMISSION_DATA',
      resource: 'emission_data',
      resourceId: parseInt(companyId),
      details: { exportedCount: records.length },
      req,
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="emissions_company_${companyId}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
