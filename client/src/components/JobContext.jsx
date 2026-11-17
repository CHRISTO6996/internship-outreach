import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';

const JobContext = createContext(null);
const ACTIVE = new Set(['queued', 'running', 'pausing', 'paused']);

export function JobProvider({ children }) {
  const [job, setJob] = useState(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const finishedRef = useRef(null);
  const pollRef = useRef(null);

  const applyJob = useCallback(
    (next) => {
      setJob(next);
      if (!next) return;
      if (!ACTIVE.has(next.status)) {
        if (finishedRef.current !== next.id) {
          finishedRef.current = next.id;
          setVersion((value) => value + 1);
          if (next.status === 'completed') {
            toast.success(
              `Discovery finished: ${next.processed} processed${next.failedCount ? `, ${next.failedCount} failed` : ''}.`,
              { title: `Job #${next.id}` },
            );
          } else if (next.status === 'stopped') {
            toast.warning(`Job #${next.id} was stopped.`, { title: 'Stopped' });
          } else if (next.status === 'failed') {
            toast.error(next.error || 'The job failed.', { title: `Job #${next.id}` });
          }
        }
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    },
    [toast],
  );

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/jobs?limit=10');
      applyJob(data.active || null);
      return data;
    } catch {
      return null;
    }
  }, [applyJob]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!job || !ACTIVE.has(job.status)) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return undefined;
    }
    if (pollRef.current) return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const fresh = await api.get(`/jobs/${job.id}`);
        applyJob(fresh);
      } catch {
        /* transient */
      }
    }, 1500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [job, applyJob]);

  const start = useCallback(
    async (companyIds) => {
      if (!companyIds?.length) {
        toast.warning('Select at least one company first.');
        return null;
      }
      setBusy(true);
      try {
        const created = await api.post('/jobs', { companyIds });
        finishedRef.current = null;
        applyJob(created);
        toast.info(`Processing ${created.total} company(ies) one by one.`, { title: `Job #${created.id}` });
        return created;
      } catch (error) {
        toast.error(error.message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [applyJob, toast],
  );

  const control = useCallback(
    async (action) => {
      if (!job) return;
      setBusy(true);
      try {
        const updated = await api.post(`/jobs/${job.id}/${action}`);
        applyJob(updated);
        if (action === 'pause') toast.info('Pausing after the current company finishes.');
        if (action === 'resume') toast.info('Resuming discovery.');
        if (action === 'stop') toast.warning('Stopping now.');
      } catch (error) {
        toast.error(error.message);
      } finally {
        setBusy(false);
      }
    },
    [job, applyJob, toast],
  );

  const value = useMemo(
    () => ({ job, version, busy, refresh, start, control, setJob: applyJob }),
    [job, version, busy, refresh, start, control, applyJob],
  );

  return <JobContext.Provider value={value}>{children}</JobContext.Provider>;
}

export function useJobs() {
  const context = useContext(JobContext);
  if (!context) throw new Error('useJobs must be used inside JobProvider');
  return context;
}

export { ACTIVE as ACTIVE_JOB_STATUSES };
