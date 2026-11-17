import { Link } from 'react-router-dom';
import { ArrowLeft, Compass, LayoutDashboard } from 'lucide-react';
import { Card, EmptyState } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <Card className="mx-auto max-w-2xl p-6">
      <EmptyState
        icon={Compass}
        title="This page does not exist"
        description="The address may be mistyped, or the section has moved. Use the navigation to continue."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/" className="btn-primary">
              <LayoutDashboard className="h-4 w-4" /> Dashboard
            </Link>
            <button type="button" className="btn-secondary" onClick={() => window.history.back()}>
              <ArrowLeft className="h-4 w-4" /> Go back
            </button>
          </div>
        }
      />
    </Card>
  );
}
