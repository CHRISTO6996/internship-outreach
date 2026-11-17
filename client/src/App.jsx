import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { JobProvider } from './components/JobContext.jsx';
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
import NotFound from './pages/NotFound.jsx';

export default function App() {
  return (
    <ToastProvider>
      <JobProvider>
        <Layout>
          <Routes>
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
    </ToastProvider>
  );
}
