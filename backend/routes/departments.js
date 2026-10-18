const express = require('express');
const { body, validationResult } = require('express-validator');
const { Department, Company, CompanyMember } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const logAudit = require('../utils/auditLogger');

const router = express.Router();

router.use(authenticate);

// ─── GET DEPARTMENTS FOR MY COMPANY ───────────────────
router.get('/mine', async (req, res) => {
  try {
    const company = await Company.findOne({ where: { ownerId: req.user.id } });
    const membership = company ? null : await CompanyMember.findOne({
      where: { userId: req.user.id, status: 'active' },
      include: [{ model: Company, as: 'company' }],
      order: [['createdAt', 'DESC']],
    });
    const resolvedCompany = company || membership?.company;
    if (!resolvedCompany) {
      return res.status(404).json({ message: 'No company profile found' });
    }

    const departments = await Department.findAll({
      where: { companyId: resolvedCompany.id },
      order: [['name', 'ASC']],
    });

    res.json({ departments, companyId: resolvedCompany.id });
  } catch (err) {
    console.error('Get departments error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── CREATE DEPARTMENT ────────────────────────────────
router.post(
  '/',
  authorize('company_rep', 'admin'),
  [
    body('companyId').isInt(),
    body('name').trim().notEmpty().withMessage('Department name is required'),
    body('description').optional().trim(),
    body('location').optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
      }

      const { companyId, name, description, location } = req.body;

      // Verify ownership or company_rep membership
      const company = await Company.findByPk(companyId);
      if (!company) return res.status(404).json({ message: 'Company not found' });

      const membership = await CompanyMember.findOne({ where: { companyId, userId: req.user.id, status: 'active' } });
      const canManage = req.user.role === 'admin' || company.ownerId === req.user.id || (membership && membership.role === 'company_rep');
      if (!canManage) return res.status(403).json({ message: 'Access denied' });

      const department = await Department.create({ companyId, name, description, location });

      await logAudit({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'CREATE_DEPARTMENT',
        resource: 'departments',
        resourceId: department.id,
        details: { departmentName: name, companyId },
        req,
      });

      res.status(201).json({ message: 'Department created', department });
    } catch (err) {
      console.error('Create department error:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// ─── UPDATE DEPARTMENT ────────────────────────────────
router.put(
  '/:id',
  authorize('company_rep', 'admin'),
  [
    body('name').optional().trim().notEmpty(),
    body('description').optional().trim(),
    body('location').optional().trim(),
    body('isActive').optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
      }

      const department = await Department.findByPk(req.params.id, {
        include: [{ model: Company, as: 'company' }],
      });
      if (!department) return res.status(404).json({ message: 'Department not found' });

      const membership = await CompanyMember.findOne({ where: { companyId: department.company.id, userId: req.user.id, status: 'active' } });
      const canManage = req.user.role === 'admin' || department.company.ownerId === req.user.id || (membership && membership.role === 'company_rep');
      if (!canManage) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const allowed = ['name', 'description', 'location', 'isActive'];
      const updates = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      await department.update(updates);

      await logAudit({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'UPDATE_DEPARTMENT',
        resource: 'departments',
        resourceId: department.id,
        details: updates,
        req,
      });

      res.json({ message: 'Department updated', department });
    } catch (err) {
      console.error('Update department error:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// ─── DELETE DEPARTMENT ────────────────────────────────
router.delete('/:id', authorize('company_rep', 'admin'), async (req, res) => {
  try {
    const department = await Department.findByPk(req.params.id, {
      include: [{ model: Company, as: 'company' }],
    });
    if (!department) return res.status(404).json({ message: 'Department not found' });

    const membership = await CompanyMember.findOne({ where: { companyId: department.company.id, userId: req.user.id, status: 'active' } });
    const canManage = req.user.role === 'admin' || department.company.ownerId === req.user.id || (membership && membership.role === 'company_rep');
    if (!canManage) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'DELETE_DEPARTMENT',
      resource: 'departments',
      resourceId: department.id,
      details: { departmentName: department.name },
      req,
    });

    await department.destroy();
    res.json({ message: 'Department deleted' });
  } catch (err) {
    console.error('Delete department error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
