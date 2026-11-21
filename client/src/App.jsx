import { Navigate, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { AuthProvider, useAuth } from './components/AuthContext.jsx';
import { JobProvider } from './components/JobContext.jsx';
import { Spinner } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AddCompanies from './pages/AddCompanies.jsx';
import EmailFinder from './pages/EmailFinder.jsx';
import CompanyDatabase from './pages/CompanyDatabase.jsx';
import CompanyDetail from './pages/CompanyDetail.jsx';
import Outreach from './pages/Outreach.jsx';
import SentEmails from './pages/SentEmails.jsx';
import Inbox from './pages/Inbox.jsx';
import FollowUps from './pages/FollowUps.jsx';
import Spreadsheet from './pages/Spreadsheet.jsx';
import ActivityLog from './pages/ActivityLog.jsx';
import Integrations from './pages/Integrations.jsx';
import SettingsPage from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-slate-500">
        <div className="flex items-center gap-3 text-sm font-medium">
          <Spinner className="h-5 w-5" />
          <span>Loading workspace…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <JobProvider>
      <Layout>
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/" element={<Dashboard />} />
          <Route path="/add" element={<AddCompanies />} />
          <Route path="/finder" element={<EmailFinder />} />
          <Route path="/companies" element={<CompanyDatabase />} />
          <Route path="/companies/:id" element={<CompanyDetail />} />
          <Route path="/outreach" element={<Outreach />} />
          <Route path="/sent" element={<SentEmails />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/follow-ups" element={<FollowUps />} />
          <Route path="/spreadsheet" element={<Spreadsheet />} />
          <Route path="/activity" element={<ActivityLog />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </JobProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ToastProvider>
  );
}
