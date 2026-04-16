import { create } from 'zustand';
import { getScans, patchScanFeedback } from '../api';

const PAGE_SIZE = 20;

export const useScanStore = create((set, get) => ({
  scans: [],
  loading: false,
  error: null,
  hasMore: true,

  async fetchScans(userId, reset = false) {
    if (!userId) return;
    const { scans, loading } = get();
    if (loading) return;

    const offset = reset ? 0 : scans.length;

    set({ loading: true, error: null });
    try {
      const rows = await getScans(userId, PAGE_SIZE, offset);
      set({
        scans: reset ? rows : [...scans, ...rows],
        hasMore: rows.length === PAGE_SIZE,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: err.message || 'Failed to load scans.' });
    }
  },

  addScan(scanResult) {
    if (!scanResult?.id) return;
    const scans = get().scans;
    if (scans.some((item) => item.id === scanResult.id)) return;
    set({ scans: [scanResult, ...scans] });
  },

  async updateFeedback(scanId, feedback, correctedClass) {
    const scans = get().scans;
    const prev = scans;

    set({
      scans: scans.map((scan) =>
        scan.id === scanId
          ? {
              ...scan,
              feedback,
              corrected_class: correctedClass ?? null,
            }
          : scan,
      ),
    });

    try {
      const userId = get().scans.find((s) => s.id === scanId)?.user_id;
      if (!userId) throw new Error('Missing user context for feedback update.');
      const updated = await patchScanFeedback(scanId, userId, feedback, correctedClass);

      set({
        scans: get().scans.map((scan) => (scan.id === scanId ? { ...scan, ...updated } : scan)),
      });
      return updated;
    } catch (err) {
      set({ scans: prev, error: err.message || 'Failed to update feedback.' });
      throw err;
    }
  },
}));
