# CFIS - Carbon Footprint & Intelligence System

CFIS is an AI-powered Enterprise Carbon Footprint Tracking and Intelligence Platform designed to monitor, analyze, and forecast greenhouse gas (GHG) emissions. The system integrates automated utility bill processing (OCR), robust data collection pipelines, and machine learning models to detect carbon anomalies and predict future emissions trends.

## 🚀 Key Features

*   **Emission Tracking & Analysis:** Comprehensive data collection dashboard categorized by departments and sectors.
*   **AI Insights & Forecasting:** Machine learning engine predicting future emissions trends based on historic consumption data.
*   **Anomaly Detection:** Built-in isolation forest models to flag sudden and unusual spikes in carbon metrics.
*   **Automated Document Processing (OCR):** Upload electricity bills (PDF/CSV) to automatically extract data and convert it to standardized emissions metrics.
*   **Dynamic Report Generation:** Automated word-to-pdf rendering system to compile carbon performance indices.
*   **Enterprise-Grade Access Control:** Audit logging, user profile management, and multi-tier organizational onboarding.

---

## 🛠️ Tech Stack & Architecture

### Frontend (User Interface)
*   **Framework:** ReactJS
*   **Styling:** Tailwind CSS / PostCSS
*   **State Management:** React Context API (AuthContext)
*   **Routing:** React Router DOM (with protected route guards)

### Backend (Server Layer)
*   **Runtime Environment:** Node.js / Express
*   **Database:** SQLite (`cfis.sqlite`) with Sequelize ORM
*   **File Management:** Multer-based secure pipeline for local testing uploads

### Machine Learning Core
*   **Language:** Python 3.10+
*   **Framework:** Flask (ML API endpoint)
*   **Models Utilized:** Isolation Forest (Anomaly Detection), Scaler Kernels, and Statistical Reference Engines
*   **Libraries:** `scikit-learn`, `joblib`, `pandas`, `numpy`

---

## 📂 Project Repository Structure

```text
├── backend/            # Express.js REST API server
│   ├── config/         # Database and server environments
│   ├── middleware/     # JWT Auth & Upload constraints
│   ├── ml/             # Python Flask API & serialized .joblib models
│   ├── models/         # Database schemas (User, Company, EmissionData, AuditLog)
│   └── routes/         # Dedicated routing split by feature (ocr, ai, emissions)
├── datasets/           # Standardized tracking CSV data (OWID, DEFRA emission factors)
├── frontend/           # React single-page application (SPA)
│   ├── src/components/ # Shared layout blocks
│   └── src/pages/      # Feature screens (Dashboard, DataCollection, Forecasting)
├── pdf_gen/            # Document parsing and templating utility script
├── start.bat           # Automated environment initialization script for Windows
└── start.sh            # Automated environment initialization script for Bash / Linux
```

---

## 💻 Setup & Local Installation

### Prerequisites
Make sure you have [Node.js](https://nodejs.org) and [Python 3.10+](https://python.org) installed locally on your system.

### 1. Clone the Repository
```bash
git clone https://github.com
cd FinalYearProject
```

### 2. Configure the Backend Dependencies
```bash
cd backend
npm install
```
*Create a `.env` file inside the backend root directory to add your local port configurations and private token parameters.*

### 3. Setup the Python ML API
```bash
cd backend/ml
pip install -r requirements.txt
```

### 4. Configure the Frontend Dependencies
```bash
cd ../../frontend
npm install
```
The frontend uses `http://localhost:5000/api` by default. To point it at a different backend, create `frontend/.env.local` with `REACT_APP_API_URL` set to the backend API base URL, then restart the frontend.

---

## ⚡ Running the System

You can initialize both environments manually or execute the dynamic automation scripts included in the root directory:

*   **On Windows:** Double-click `start.bat`
*   **On Linux / macOS:** Run `chmod +x start.sh && ./start.sh`

Once initialized:
*   The backend gateway will serve routes on your designated port.
*   The frontend client will be accessible at `http://localhost:3000`.
