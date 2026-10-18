import React, { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import API from '../utils/api';

export default function BillUploadPage() {
  const [company, setCompany] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tab, setTab] = useState('csv'); // csv | ocr
  const [selectedDept, setSelectedDept] = useState('');
  const [importResult, setImportResult] = useState(null);

  // OCR state
  const [ocrResult, setOcrResult] = useState(null);
  const [ocrForm, setOcrForm] = useState({
    category: '', quantity: '', unit: '', periodStart: '', periodEnd: '', notes: '',
  });

  useEffect(() => { fetchCompany(); }, []);

  const fetchCompany = async () => {
    try {
      const { data } = await API.get('/company/mine');
      setCompany(data.company);
      setDepartments(data.company.departments || []);
      fetchUploads(data.company.id);
    } catch {
      setError('Please complete company onboarding first');
    } finally {
      setLoading(false);
    }
  };

  const fetchUploads = async (cId) => {
    try {
      const { data } = await API.get('/emissions/uploads', { params: { companyId: cId } });
      setUploads(data.uploads);
    } catch {
      // silent
    }
  };

  // CSV/Excel upload handler
  const onDropCSV = useCallback(async (acceptedFiles, fileRejections) => {
    if (fileRejections.length > 0) {
      const rejection = fileRejections[0];
      const errorCode = rejection.errors[0]?.code;
      setError(errorCode === 'file-too-large'
        ? 'File is larger than the 10 MB limit'
        : `Unsupported file. Please choose a CSV, XLS, or XLSX file${rejection.file?.name ? ` (received ${rejection.file.name})` : ''}.`);
      return;
    }
    if (!acceptedFiles.length || !company) return;
    const file = acceptedFiles[0];
    const formData = new FormData();
    formData.append('file', file);
    formData.append('companyId', company.id);
    if (selectedDept) formData.append('departmentId', selectedDept);

    setUploading(true);
    setError('');
    setImportResult(null);
    try {
      const { data } = await API.post('/emissions/upload', formData);
      setImportResult(data);
      setSuccess(data.errors?.length
        ? `${data.importedCount} records imported; ${data.errors.length} rows were skipped`
        : `${data.importedCount} records imported successfully`);
      fetchUploads(company.id);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setImportResult(err.response?.data?.importedCount !== undefined ? err.response.data : null);
      setError(err.response?.data?.error || err.response?.data?.message || 'Upload failed');
      fetchUploads(company.id);
    } finally {
      setUploading(false);
    }
  }, [company, selectedDept]);

  // OCR bill upload handler
  const onDropOCR = useCallback(async (acceptedFiles) => {
    if (!acceptedFiles.length || !company) return;
    const file = acceptedFiles[0];
    const formData = new FormData();
    formData.append('file', file);
    formData.append('companyId', company.id);
    if (selectedDept) formData.append('departmentId', selectedDept);

    setProcessing(true);
    setError('');
    setOcrResult(null);
    try {
      const { data } = await API.post('/ocr/process', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setOcrResult(data);
      // Pre-fill OCR form with extracted data
      const extracted = data.extractedData || {};
      setOcrForm({
        category: extracted.category || '',
        quantity: extracted.quantity || '',
        unit: extracted.unit || '',
        periodStart: '',
        periodEnd: '',
        notes: '',
      });
      setSuccess('Bill processed! Review and confirm the extracted data below.');
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.response?.data?.message || 'OCR processing failed');
    } finally {
      setProcessing(false);
    }
  }, [company, selectedDept]);

  const confirmOCR = async () => {
    if (!ocrForm.category || !ocrForm.quantity || !ocrForm.periodStart || !ocrForm.periodEnd) {
      setError('Fill in all required fields before confirming');
      return;
    }
    setProcessing(true);
    try {
      await API.post('/ocr/confirm', {
        billUploadId: ocrResult?.billUpload?.id,
        companyId: company.id,
        departmentId: selectedDept ? parseInt(selectedDept) : null,
        category: ocrForm.category,
        quantity: parseFloat(ocrForm.quantity),
        unit: ocrForm.unit,
        periodStart: ocrForm.periodStart,
        periodEnd: ocrForm.periodEnd,
        notes: ocrForm.notes,
      });
      setSuccess('OCR data confirmed and saved as emission record');
      setOcrResult(null);
      setOcrForm({ category: '', quantity: '', unit: '', periodStart: '', periodEnd: '', notes: '' });
      fetchUploads(company.id);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to confirm data');
    } finally {
      setProcessing(false);
    }
  };

  const csvDropzone = useDropzone({
    onDrop: onDropCSV,
    accept: {
      'text/csv': ['.csv'],
      'application/csv': ['.csv'],
      'text/comma-separated-values': ['.csv'],
      'application/vnd.ms-excel': ['.csv', '.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/plain': ['.csv'],
      'application/octet-stream': ['.csv'],
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    disabled: uploading,
  });

  const ocrDropzone = useDropzone({
    onDrop: onDropOCR,
    accept: { 'application/pdf': ['.pdf'], 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'] },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    disabled: processing,
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Bill Upload & OCR</h1>
        <p className="text-sm text-on-surface-variant mt-1">Upload CSV/Excel files or scan bills using OCR</p>
      </div>

      {error && (
        <div className="p-4 bg-error-container/30 border border-error/20 rounded-xl text-error text-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>{error}
          <button onClick={() => setError('')} className="ml-auto"><span className="material-symbols-outlined text-[16px]">close</span></button>
        </div>
      )}
      {success && (
        <div className="p-4 bg-primary-container/20 border border-primary/20 rounded-xl text-primary text-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>{success}
        </div>
      )}

      {/* Department Selector */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <label className="text-sm font-medium text-on-surface-variant">Target Department:</label>
        <select value={selectedDept} onChange={(e) => setSelectedDept(e.target.value)}
          className="px-3 py-2 rounded-xl border border-outline-variant/50 bg-surface text-sm text-on-surface min-w-[200px]">
          <option value="">Company-wide</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-2 bg-surface-container-high rounded-xl p-1">
        <button onClick={() => setTab('csv')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'csv' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface'
          }`}>
          <span className="material-symbols-outlined text-[18px]">table_chart</span>
          CSV / Excel Upload
        </button>
        <button onClick={() => setTab('ocr')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'ocr' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface'
          }`}>
          <span className="material-symbols-outlined text-[18px]">document_scanner</span>
          OCR Bill Scan
        </button>
      </div>

      {/* CSV/Excel Upload */}
      {tab === 'csv' && (
        <div className="bg-surface-bright rounded-2xl border border-outline-variant/30 p-6 shadow-sm space-y-5">
          <div>
            <h2 className="text-base font-semibold text-on-surface mb-2">Upload Data File</h2>
            <p className="text-xs text-on-surface-variant">
              CSV/Excel should have columns: <code className="bg-surface-container-high px-1.5 py-0.5 rounded text-primary">category, quantity, unit, period_start, period_end</code>
              <br />Optional: <code className="bg-surface-container-high px-1.5 py-0.5 rounded text-primary">sub_category, emission_factor, scope, notes</code>
            </p>
          </div>

          <div {...csvDropzone.getRootProps()}
            className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
              csvDropzone.isDragActive ? 'border-primary bg-primary-container/10' :
              uploading ? 'border-outline-variant/30 bg-surface-container-low opacity-60' :
              'border-outline-variant/40 hover:border-primary/50 hover:bg-surface-container-low/50'
            }`}>
            <input {...csvDropzone.getInputProps()} />
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent" />
                <p className="text-sm text-on-surface-variant">Processing file...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <span className="material-symbols-outlined text-4xl text-on-surface-variant/50">upload_file</span>
                <div>
                  <p className="text-sm font-medium text-on-surface">Drop CSV or Excel file here</p>
                  <p className="text-xs text-on-surface-variant mt-1">or click to browse (max 10MB)</p>
                </div>
              </div>
            )}
          </div>

          {/* Import result */}
          {importResult && (
            <div className="bg-surface-container-low rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                <span className={`material-symbols-outlined text-[18px] ${importResult.importedCount > 0 ? 'text-primary' : 'text-error'}`}>
                  {importResult.importedCount > 0 ? 'check_circle' : 'error'}
                </span>
                Import Results
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div className="p-3 bg-surface rounded-lg">
                  <p className="text-on-surface-variant text-xs">Records Imported</p>
                  <p className="text-lg font-bold text-primary">{importResult.importedCount}</p>
                </div>
                <div className="p-3 bg-surface rounded-lg">
                  <p className="text-on-surface-variant text-xs">Errors</p>
                  <p className="text-lg font-bold text-error">{importResult.errors?.length || 0}</p>
                </div>
              </div>
              {importResult.errors?.length > 0 && (
                <div className="max-h-32 overflow-y-auto text-xs text-error space-y-1 bg-error-container/10 rounded-lg p-3">
                  {importResult.errors.map((err, i) => <div key={i}>{err}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* OCR Bill Scan */}
      {tab === 'ocr' && (
        <div className="bg-surface-bright rounded-2xl border border-outline-variant/30 p-6 shadow-sm space-y-5">
          <div>
            <h2 className="text-base font-semibold text-on-surface mb-2">Scan Bill (OCR)</h2>
            <p className="text-xs text-on-surface-variant">Upload a utility bill (PDF, PNG, JPG) and we'll extract the data automatically.</p>
          </div>

          <div {...ocrDropzone.getRootProps()}
            className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
              ocrDropzone.isDragActive ? 'border-primary bg-primary-container/10' :
              processing ? 'border-outline-variant/30 bg-surface-container-low opacity-60' :
              'border-outline-variant/40 hover:border-primary/50 hover:bg-surface-container-low/50'
            }`}>
            <input {...ocrDropzone.getInputProps()} />
            {processing ? (
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent" />
                <p className="text-sm text-on-surface-variant">Scanning bill with OCR...</p>
                <p className="text-xs text-on-surface-variant">This may take a moment</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <span className="material-symbols-outlined text-4xl text-on-surface-variant/50">document_scanner</span>
                <div>
                  <p className="text-sm font-medium text-on-surface">Drop bill image/PDF here</p>
                  <p className="text-xs text-on-surface-variant mt-1">PDF, PNG, JPG (max 10MB)</p>
                </div>
              </div>
            )}
          </div>

          {/* OCR Result */}
          {ocrResult && (
            <div className="space-y-5">
              {/* Extracted text preview */}
              <div className="bg-surface-container-low rounded-xl p-4">
                <h3 className="text-sm font-semibold text-on-surface mb-2 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] text-primary">text_snippet</span>
                  Extracted Text
                </h3>
                <pre className="text-xs text-on-surface-variant whitespace-pre-wrap max-h-40 overflow-y-auto bg-surface rounded-lg p-3 font-mono">
                  {ocrResult.ocrText || 'No text extracted'}
                </pre>
              </div>

              {/* Editable form with extracted values */}
              <div className="bg-surface-container-low rounded-xl p-4">
                <h3 className="text-sm font-semibold text-on-surface mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] text-primary">edit</span>
                  Review & Confirm Data
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">Category *</label>
                    <select value={ocrForm.category} onChange={(e) => setOcrForm({ ...ocrForm, category: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-outline-variant/50 bg-surface text-sm text-on-surface">
                      <option value="">Select category</option>
                      <option value="electricity">Electricity</option>
                      <option value="natural_gas">Natural Gas</option>
                      <option value="fuel">Fuel</option>
                      <option value="water">Water</option>
                      <option value="waste">Waste</option>
                      <option value="transport">Transport</option>
                      <option value="refrigerants">Refrigerants</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">Quantity *</label>
                    <input type="number" step="any" value={ocrForm.quantity}
                      onChange={(e) => setOcrForm({ ...ocrForm, quantity: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-outline-variant/50 bg-surface text-sm text-on-surface" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">Unit</label>
                    <input value={ocrForm.unit} onChange={(e) => setOcrForm({ ...ocrForm, unit: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-outline-variant/50 bg-surface text-sm text-on-surface" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">Period Start *</label>
                    <input type="date" value={ocrForm.periodStart}
                      onChange={(e) => setOcrForm({ ...ocrForm, periodStart: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-outline-variant/50 bg-surface text-sm text-on-surface" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">Period End *</label>
                    <input type="date" value={ocrForm.periodEnd}
                      onChange={(e) => setOcrForm({ ...ocrForm, periodEnd: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-outline-variant/50 bg-surface text-sm text-on-surface" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">Notes</label>
                    <input value={ocrForm.notes} onChange={(e) => setOcrForm({ ...ocrForm, notes: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-outline-variant/50 bg-surface text-sm text-on-surface" />
                  </div>
                </div>
                <div className="mt-4 flex gap-3">
                  <button onClick={confirmOCR} disabled={processing}
                    className="flex items-center gap-2 px-5 py-2 bg-primary text-on-primary rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                    <span className="material-symbols-outlined text-[18px]">check</span>
                    Confirm & Save
                  </button>
                  <button onClick={() => setOcrResult(null)}
                    className="px-5 py-2 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container-high transition-colors">
                    Discard
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload History */}
      <div className="bg-surface-bright rounded-2xl border border-outline-variant/30 shadow-sm">
        <div className="p-6 border-b border-outline-variant/20">
          <h2 className="text-base font-semibold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">history</span>
            Upload History ({uploads.length})
          </h2>
        </div>
        {uploads.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-5xl text-on-surface-variant/40">cloud_upload</span>
            <p className="text-on-surface-variant mt-3">No uploads yet</p>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/10">
            {uploads.map((u) => (
              <div key={u.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    u.fileType === 'csv' ? 'bg-green-100 text-green-700' :
                    u.fileType === 'excel' ? 'bg-blue-100 text-blue-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    <span className="material-symbols-outlined text-[20px]">
                      {u.fileType === 'csv' ? 'table_chart' : u.fileType === 'excel' ? 'grid_on' : 'picture_as_pdf'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-on-surface truncate">{u.originalName}</p>
                    <p className="text-xs text-on-surface-variant">
                      {new Date(u.createdAt).toLocaleDateString()} · {(u.fileSize / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-on-surface-variant">{u.recordsImported} records</span>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    u.status === 'completed' ? 'bg-primary-container/30 text-primary' :
                    u.status === 'failed' ? 'bg-error-container/30 text-error' :
                    u.status === 'processing' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-surface-container-high text-on-surface-variant'
                  }`}>
                    {u.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
