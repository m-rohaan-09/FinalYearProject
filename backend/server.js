const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const sequelize = require('./config/database');
const { User } = require('./models');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const profileRoutes = require('./routes/profile');
const companyRoutes = require('./routes/company');
const companyMemberRoutes = require('./routes/companyMembers');
const departmentRoutes = require('./routes/departments');
const emissionRoutes = require('./routes/emissions');
const ocrRoutes = require('./routes/ocr');
const baselineRoutes = require('./routes/baseline');
const aiRoutes = require('./routes/ai');

const app = express();

// Security
app.use(helmet());
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: 'Too many requests, please try again later.' },
});

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/company-members', companyMemberRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/emissions', emissionRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/baseline', baselineRoutes);
app.use('/api/ai', aiRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 5000;

const start = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connected');

    // Disable FK constraints during sync so SQLite doesn't block table creation
    await sequelize.query('PRAGMA foreign_keys = OFF');
    await sequelize.sync({ alter: false }); // only creates missing tables, never drops
    await sequelize.query('PRAGMA foreign_keys = ON');
    console.log('Models synced');

    // Seed admin user if none exists
    const adminCount = await User.count({ where: { role: 'admin' } });
    if (adminCount === 0) {
      await User.create({
        firstName: 'Admin',
        lastName: 'CFIS',
        email: 'admin@cfis.com',
        password: 'Admin@1234',
        role: 'admin',
        isEmailVerified: true,
      });
      console.log('Default admin created: admin@cfis.com / Admin@1234');
    }

    app.listen(PORT, () => {
      console.log(`CFIS Backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
};

start();
