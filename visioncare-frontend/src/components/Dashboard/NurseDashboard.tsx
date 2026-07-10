import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWebSocket } from "../../hooks/useWebSocket";
import { detectionsApi, patientsApi } from "../../services/api";
import {
  NurseSocketMessage,
  PatientRequest,
  RequestStatus,
  WardStats,
} from "../../types";
import { PatientCard } from "../PatientCard/PatientCard";
import { AlertPanel } from "../AlertPanel/AlertPanel";
import { NeedBadge } from "../NeedBadge/NeedBadge";
import { StatusBadge } from "../StatusBadge/StatusBadge";

interface NurseDashboardProps {
  wardId: string;
  nurseId: string;
  nurseName?: string;
}

const WS_BASE_URL = process.env.REACT_APP_WS_URL ?? "ws://localhost:8000";

function mapDetectionToRequest(raw: any): PatientRequest {
  return {
    id: raw.id,
    patientId: raw.patient_id,
    patientName: raw.patient_name,
    bedNumber: raw.bed_number,
    need: raw.need_type ?? raw.need,
    gestureType: raw.gesture_type,
    confidence: raw.confidence,
    timestamp: new Date(raw.timestamp ?? raw.created_at),
    status: (raw.status ?? "pending") as RequestStatus,
    acknowledgedBy: raw.acknowledged_by,
    responseTimeMs: raw.response_time_ms,
  };
}

export const NurseDashboard: React.FC<NurseDashboardProps> = ({
  wardId,
  nurseId,
  nurseName = "Nurse",
}) => {
  const [requests, setRequests] = useState<PatientRequest[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());

  const [patients, setPatients] = useState<any[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPatient, setNewPatient] = useState({
    name: "",
    age: "",
    bed_number: "",
    condition: "stroke",
    notes: "",
  });

  const loadPatients = async () => {
    try {
      const res = await patientsApi.list(wardId);
      setPatients(res.data || []);
    } catch (err) {
      console.error("Failed to load patients list", err);
    }
  };

  useEffect(() => {
    loadPatients();
  }, [wardId]);

  const handleAddPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatient.name || !newPatient.age || !newPatient.bed_number) return;
    try {
      await patientsApi.create({
        name: newPatient.name,
        age: parseInt(newPatient.age, 10),
        bed_number: newPatient.bed_number,
        ward_id: wardId,
        hospital_id: "HOSP-1",
        condition: newPatient.condition,
        notes: newPatient.notes || "",
      });
      setNewPatient({ name: "", age: "", bed_number: "", condition: "stroke", notes: "" });
      setShowAddForm(false);
      loadPatients();
    } catch (err) {
      setLoadError("Failed to add patient. Please check input values.");
    }
  };

  const handleDischargePatient = async (id: string) => {
    if (!window.confirm("Are you sure you want to discharge this patient?")) return;
    try {
      await patientsApi.discharge(id);
      loadPatients();
    } catch (err) {
      setLoadError("Failed to discharge patient.");
    }
  };

  const { lastMessage, connectionStatus } = useWebSocket(
    `${WS_BASE_URL}/ws/nurse/${wardId}`
  );

  // Initial load of existing pending + recent requests from REST.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [pendingRes, recentRes] = await Promise.all([
          detectionsApi.listActive(wardId),
          detectionsApi.listRecent(wardId, 20),
        ]);
        if (cancelled) return;

        const pending = (pendingRes.data ?? []).map(mapDetectionToRequest);
        const recent = (recentRes.data ?? []).map(mapDetectionToRequest);

        const merged = new Map<string, PatientRequest>();
        [...recent, ...pending].forEach((r: PatientRequest) =>
          merged.set(r.id, r)
        );
        setRequests(Array.from(merged.values()));
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            "Couldn't load current requests. Check the backend connection."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wardId]);

  // Live updates over WebSocket.
  useEffect(() => {
    if (!lastMessage) return;

    let data: NurseSocketMessage;
    try {
      data = JSON.parse(lastMessage.data);
    } catch {
      return;
    }

    if (data.type === "new_request") {
      const incoming = mapDetectionToRequest(data);
      setRequests((prev) => {
        if (prev.some((r) => r.id === incoming.id)) return prev;
        return [incoming, ...prev];
      });
    }

    if (data.type === "request_updated") {
      const updated = mapDetectionToRequest(data);
      setRequests((prev) =>
        prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
      );
    }
  }, [lastMessage]);

  // Keep "time ago" text fresh for the pending list.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

  const handleAcknowledge = async (
    requestId: string,
    status: RequestStatus
  ) => {
    // Optimistic UI update.
    setRequests((prev) =>
      prev.map((r) => (r.id === requestId ? { ...r, status } : r))
    );
    try {
      await detectionsApi.acknowledge(requestId, nurseId, status);
    } catch {
      setLoadError("Failed to save that update. It may not be recorded.");
    }
  };

  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === "pending"),
    [requests]
  );
  const historyRequests = useMemo(
    () =>
      requests
        .filter((r) => r.status !== "pending")
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, 20),
    [requests]
  );

  const latestUrgent = useMemo(
    () =>
      pendingRequests.find((r) => r.need === "pain" || r.need === "emergency"),
    [pendingRequests]
  );

  const stats: WardStats = useMemo(() => {
    const today = new Date();
    const completedToday = requests.filter(
      (r) =>
        r.status === "completed" &&
        r.timestamp.toDateString() === today.toDateString()
    );
    const responseTimes = completedToday
      .map((r) => r.responseTimeMs)
      .filter((v): v is number => typeof v === "number");
    const avgResponseMinutes = responseTimes.length
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length / 60000
      : 0;

    return {
      activePatients: new Set(requests.map((r) => r.patientId)).size,
      pendingRequests: pendingRequests.length,
      completedToday: completedToday.length,
      avgResponseMinutes,
    };
  }, [requests, pendingRequests.length]);

  return (
    <div className="min-h-screen bg-signal-mist">
      <header className="bg-gradient-to-r from-ink-900 to-ink-800 text-white shadow-card">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center text-2xl">
              👁️
            </div>
            <div>
              <h1 className="text-xl font-display font-bold">VisionCare AI</h1>
              <p className="text-white/60 text-sm">Ward {wardId}</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  connectionStatus === "connected"
                    ? "bg-emerald-400"
                    : connectionStatus === "connecting"
                    ? "bg-signal-amber animate-pulse"
                    : "bg-signal-coral"
                }`}
              />
              <span className="text-sm capitalize">{connectionStatus}</span>
            </div>
            <div className="text-right">
              <p className="font-medium">{nurseName}</p>
              <p className="text-white/60 text-sm font-mono">
                {now.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        {loadError && (
          <div className="mb-6 p-4 bg-signal-coral/10 border border-signal-coral/30 rounded-xl text-signal-coral text-sm">
            {loadError}
          </div>
        )}

        <AlertPanel
          pendingCount={pendingRequests.length}
          latestUrgent={latestUrgent}
          soundEnabled={soundEnabled}
          onToggleSound={() => setSoundEnabled((s) => !s)}
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Active patients" value={stats.activePatients} accent="border-signal-teal" />
          <StatCard
            label="Pending requests"
            value={stats.pendingRequests}
            accent="border-signal-coral"
            valueClass="text-signal-coral"
          />
          <StatCard label="Completed today" value={stats.completedToday} accent="border-emerald-500" />
          <StatCard
            label="Avg. response"
            value={
              stats.avgResponseMinutes > 0
                ? `${stats.avgResponseMinutes.toFixed(1)}m`
                : "—"
            }
            accent="border-violet-500"
          />
        </div>

        <section className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            {pendingRequests.length > 0 && (
              <span className="h-3 w-3 bg-signal-coral rounded-full animate-pulse-ring" />
            )}
            <h2 className="text-xl font-display font-semibold text-ink-900">
              Pending requests
            </h2>
          </div>

          {pendingRequests.length === 0 ? (
            <div className="bg-white rounded-xl shadow-card p-8 text-center text-gray-500">
              No pending requests. New gesture alerts will appear here in real time.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingRequests.map((request) => (
                <PatientCard
                  key={request.id}
                  request={request}
                  onAcknowledge={handleAcknowledge}
                  urgent={request.need === "pain" || request.need === "emergency"}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-display font-semibold text-ink-900">
              Monitored Bedside Patients
            </h2>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="py-2 px-4 bg-signal-teal text-white rounded-lg text-sm font-medium hover:bg-signal-teal/90 transition-colors"
            >
              {showAddForm ? "Cancel" : "+ Add Patient"}
            </button>
          </div>

          {showAddForm && (
            <form onSubmit={handleAddPatient} className="bg-white rounded-xl shadow-card p-6 mb-6 grid grid-cols-1 md:grid-cols-5 gap-4 items-end animate-slide-in">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Patient Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={newPatient.name}
                  onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-ink-800 focus:border-signal-teal focus:ring-1 focus:ring-signal-teal"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Age</label>
                <input
                  type="number"
                  required
                  placeholder="e.g. 65"
                  value={newPatient.age}
                  onChange={(e) => setNewPatient({ ...newPatient, age: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-ink-800 focus:border-signal-teal focus:ring-1 focus:ring-signal-teal"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Bed Number</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 102A"
                  value={newPatient.bed_number}
                  onChange={(e) => setNewPatient({ ...newPatient, bed_number: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-ink-800 focus:border-signal-teal focus:ring-1 focus:ring-signal-teal"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Condition</label>
                <select
                  value={newPatient.condition}
                  onChange={(e) => setNewPatient({ ...newPatient, condition: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-ink-800 focus:border-signal-teal focus:ring-1 focus:ring-signal-teal"
                >
                  <option value="stroke">Stroke</option>
                  <option value="als">ALS</option>
                  <option value="paralysis">Paralysis</option>
                  <option value="post_surgery">Post Surgery</option>
                  <option value="elderly">Elderly</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <button
                  type="submit"
                  className="w-full py-2.5 px-4 bg-ink-900 text-white rounded-lg font-medium hover:bg-ink-800 transition-colors text-sm"
                >
                  Save Patient
                </button>
              </div>
            </form>
          )}

          {patients.length === 0 ? (
            <div className="bg-white rounded-xl shadow-card p-8 text-center text-gray-500">
              No patients registered. Add a patient above to start bedside gesture scanning.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {patients.map((p) => (
                <div key={p.id} className="bg-white rounded-xl shadow-card p-5 border border-gray-100 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <span className="text-xl font-display font-bold text-ink-900">Bed {p.bed_number}</span>
                        <h3 className="text-gray-700 font-medium">{p.name}</h3>
                      </div>
                      <span className="px-2.5 py-1 bg-signal-teal/10 text-signal-teal text-xs font-medium rounded-full capitalize">
                        {p.condition}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-4">Age: {p.age} | Ward: {p.ward_id}</p>
                  </div>
                  <div className="flex flex-col gap-2 mt-2">
                    <Link
                      to={`/patients/${p.id}/monitor`}
                      target="_blank"
                      className="w-full text-center py-2 px-3 bg-signal-teal text-white rounded-lg text-sm font-medium hover:bg-signal-teal/90 transition-colors"
                    >
                      🎥 Open Bedside Camera
                    </Link>
                    <div className="grid grid-cols-2 gap-2">
                      <Link
                        to={`/patients/${p.id}/calibration`}
                        className="text-center py-1.5 px-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"
                      >
                        ⚙️ Calibrate
                      </Link>
                      <Link
                        to={`/patients/${p.id}/setup-mappings`}
                        className="text-center py-1.5 px-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"
                      >
                        ⚡ Mappings
                      </Link>
                    </div>
                    <button
                      onClick={() => handleDischargePatient(p.id)}
                      className="w-full py-1.5 px-3 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 transition-colors mt-1"
                    >
                      Discharge Patient
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-display font-medium text-ink-800 mb-4">
            Recent activity
          </h2>
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {["Bed", "Patient", "Need", "Time", "Status"].map((h) => (
                    <th
                      key={h}
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {historyRequests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                      No activity yet today.
                    </td>
                  </tr>
                ) : (
                  historyRequests.map((request) => (
                    <tr key={request.id}>
                      <td className="px-6 py-4 whitespace-nowrap font-medium text-ink-900">
                        {request.bedNumber}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                        {request.patientName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <NeedBadge need={request.need} size="sm" />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-500 text-sm">
                        {request.timestamp.toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge status={request.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
};

const StatCard: React.FC<{
  label: string;
  value: string | number;
  accent: string;
  valueClass?: string;
}> = ({ label, value, accent, valueClass }) => (
  <div className={`bg-white rounded-xl p-4 shadow-card border-l-4 ${accent}`}>
    <p className="text-gray-500 text-sm">{label}</p>
    <p className={`text-2xl font-display font-bold text-ink-900 ${valueClass ?? ""}`}>
      {value}
    </p>
  </div>
);

export default NurseDashboard;
