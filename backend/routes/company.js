const express = require('express');
const { body, validationResult } = require('express-validator');
const sequelize = require('../config/database');
const { Company, CompanyMember, Department, EmissionData, BillUpload } = require('../models');
const { authenticate, authorize, requirePermission } = require('../middleware/auth');
const logAudit = require('../utils/auditLogger');

const router = express.Router();

router.use(authenticate);

// ─── GET MY COMPANY ───────────────────────────────────
router.get('/mine', async (req, res) => {
  try {
    let company = await Company.findOne({
      where: { ownerId: req.user.id },
      include: [{ model: Department, as: 'departments' }],
    });

    if (!company) {
      const membership = await CompanyMember.findOne({
        where: { userId: req.user.id, status: 'active' },
        include: [{
          model: Company,
          as: 'company',
          include: [{ model: Department, as: 'departments' }],
        }],
        order: [['createdAt', 'DESC']],
      });
      company = membership?.company || null;
    }

    if (!company) {
      return res.status(404).json({
        message: 'No company profile found',
        needsOnboarding: req.user.role === 'company_rep' || req.user.role === 'admin',
      });
    }

    res.json({ company });
  } catch (err) {
    console.error('Get company error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── CREATE COMPANY (Onboarding) ──────────────────────
router.post(
  '/',
  authorize('company_rep', 'admin'),
  [
    body('name').trim().notEmpty().withMessage('Company name is required'),
    body('industry').optional().trim(),
    body('registrationNumber').optional().trim(),
    body('country').optional().trim(),
    body('province').optional().trim(),
    body('city').optional().trim(),
    body('address').optional().trim(),
    body('website').optional().trim(),
    body('employeeCount').optional().isInt({ min: 1 }),
    body('fiscalYearStart').optional().isDate(),
    body('baselineYear').optional().isInt({ min: 2000, max: 2100 }),
  ],
  async (req, res) => {
    let transaction;
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
      }

      // Check if user already has a company
      const existing = await Company.findOne({ where: { ownerId: req.user.id } });
      if (existing) {
        return res.status(409).json({ message: 'Company profile already exists' });
      }

      transaction = await sequelize.transaction();
      const company = await Company.create({
        ...req.body,
        ownerId: req.user.id,
      }, { transaction });

      await CompanyMember.create({
        companyId: company.id,
        userId: req.user.id,
        role: 'company_rep',
        status: 'active',
        invitedBy: req.user.id,
        joinedAt: new Date(),
      }, { transaction });

      await transaction.commit();
      transaction = null;

      await logAudit({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'CREATE_COMPANY',
        resource: 'companies',
        resourceId: company.id,
        details: { companyName: company.name },
        req,
      });

      res.status(201).json({ message: 'Company profile created', company });
    } catch (err) {
      if (transaction) await transaction.rollback();
      console.error('Create company error:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// ─── DELETE COMPANY (Admin only) ───────────────────────
router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id);
    if (!company) return res.status(404).json({ message: 'Company not found' });

    await sequelize.transaction(async (transaction) => {
      await CompanyMember.destroy({ where: { companyId: company.id }, transaction });
      await EmissionData.destroy({ where: { companyId: company.id }, transaction });
      await BillUpload.destroy({ where: { companyId: company.id }, transaction });
      await Department.destroy({ where: { companyId: company.id }, transaction });
      await company.destroy({ transaction });
    });

    await logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'DELETE_COMPANY',
      resource: 'companies',
      resourceId: company.id,
      details: { companyName: company.name },
      req,
    });

    res.json({ message: 'Company deleted' });
  } catch (err) {
    console.error('Delete company error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── UPDATE COMPANY ───────────────────────────────────
router.put(
  '/:id',
  authorize('company_rep', 'admin'),
  [
    body('name').optional().trim().notEmpty(),
    body('industry').optional().trim(),
    body('registrationNumber').optional().trim(),
    body('country').optional().trim(),
    body('province').optional().trim(),
    body('city').optional().trim(),
    body('address').optional().trim(),
    body('website').optional().trim(),
    body('employeeCount').optional().isInt({ min: 1 }),
    body('fiscalYearStart').optional().isDate(),
    body('baselineYear').optional().isInt({ min: 2000, max: 2100 }),
    body('onboardingCompleted').optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
      }

      const company = await Company.findByPk(req.params.id);
      if (!company) return res.status(404).json({ message: 'Company not found' });

      // Only owner, company_rep member, or admin can update
      const membership = await CompanyMember.findOne({ where: { companyId: company.id, userId: req.user.id, status: 'active' } });
      const canManageCompany = req.user.role === 'admin' || company.ownerId === req.user.id || (membership && membership.role === 'company_rep');
      if (!canManageCompany) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const allowed = [
        'name', 'industry', 'registrationNumber', 'country', 'province',
        'city', 'address', 'website', 'employeeCount', 'fiscalYearStart',
        'baselineYear', 'onboardingCompleted',
      ];
      const updates = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      await company.update(updates);

      await logAudit({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'UPDATE_COMPANY',
        resource: 'companies',
        resourceId: company.id,
        details: updates,
        req,
      });

      res.json({ message: 'Company updated', company });
    } catch (err) {
      console.error('Update company error:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// ─── GET COMPANY BY ID ────────────────────────────────
router.get('/:id', requirePermission('viewCompanyDetails'), async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id, {
      include: [{ model: Department, as: 'departments' }],
    });
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const membership = await CompanyMember.findOne({ where: { companyId: company.id, userId: req.user.id, status: 'active' } });
    if (req.user.role !== 'admin' && company.ownerId !== req.user.id && !(membership && membership.role === 'company_rep')) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ company });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── LIST ALL COMPANIES (Admin) ───────────────────────
router.get('/', authorize('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const { count, rows } = await Company.findAndCountAll({
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      include: [{ model: Department, as: 'departments' }],
    });

    res.json({
      companies: rows,
      pagination: { total: count, page, pages: Math.ceil(count / limit), limit },
    });
  } catch (err) {
    console.error('List companies error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
