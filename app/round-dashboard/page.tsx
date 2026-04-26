"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

interface Patient {
  id: string;
  hospitalCode: string;
  bedNumber: string;
  initials: string;
  diagnosis: string[];
  admissionDate: string;
  socialHistory: string;
  pmh: string;
  cc: string;
  hpi: string;
  investigations: string;
  activeIssues: string[];
  activeManagement: string[];
  managementUpdates: string[];
  dischargeDate?: string;
}

interface NewPatientForm {
  hospitalCode: string;
  bedNumber: string;
  initials: string;
  diagnosis: string[];
  admissionDate: string;
  socialHistory: string;
  pmh: string;
  cc: string;
  hpi: string;
  investigations: string;
  activeIssuesText: string;
  managementPlanText: string;
}

interface PendingDelete {
  patient: Patient;
  index: number;
  source: "active" | "discharged";
}

const ACTIVE_PATIENTS_STORAGE_KEY = "doctor-round.active-patients.v1";
const DISCHARGED_PATIENTS_STORAGE_KEY = "doctor-round.discharged-patients.v1";
const COMPLETED_MANAGEMENT_STORAGE_KEY = "doctor-round.completed-management.v1";

const todayISO = new Date().toISOString().slice(0, 10);

const initialActivePatients: Patient[] = [
  {
    id: "p-1",
    hospitalCode: "HSP-24011",
    bedNumber: "1",
    initials: "K.L.",
    diagnosis: ["Acute decompensated heart failure"],
    admissionDate: "2026-04-21",
    socialHistory: "Lives alone, daughter visits daily, independent for ADLs before admission.",
    pmh: "Type 2 diabetes, hypertension, chronic kidney disease stage 3.",
    cc: "Shortness of breath and reduced effort tolerance.",
    hpi: "3-day history of dyspnea and leg swelling, worsened overnight with orthopnea.",
    investigations:
      "CXR: pulmonary congestion. BNP elevated. Creatinine 1.9 mg/dL. ECHO pending.",
    activeIssues: ["Acute decompensated heart failure", "AKI on CKD", "Hyperglycemia"],
    activeManagement: [
      "IV furosemide 40 mg BD",
      "Fluid balance strict charting",
      "Insulin sliding scale"
    ],
    managementUpdates: ["Added nephrology review request this morning."]
  },
  {
    id: "p-2",
    hospitalCode: "HSP-24015",
    bedNumber: "2",
    initials: "M.R.",
    diagnosis: ["Community-acquired pneumonia"],
    admissionDate: "2026-04-23",
    socialHistory: "Lives with spouse, ambulates with walking frame.",
    pmh: "COPD, ischemic heart disease, previous smoker.",
    cc: "Productive cough with fever.",
    hpi: "5-day cough, yellow sputum, fever up to 38.7 C and reduced oral intake.",
    investigations:
      "WCC 16.2, CRP 188. CXR: right lower zone consolidation. Blood culture pending.",
    activeIssues: ["Community-acquired pneumonia", "COPD exacerbation"],
    activeManagement: [
      "IV ceftriaxone + azithromycin",
      "Nebulized bronchodilator q6h",
      "Chest physiotherapy"
    ],
    managementUpdates: ["Stepped down oxygen from 4 L to 2 L via nasal cannula."]
  }
];

const emptyPatientForm: NewPatientForm = {
  hospitalCode: "",
  bedNumber: "",
  initials: "",
  diagnosis: [],
  admissionDate: todayISO,
  socialHistory: "",
  pmh: "",
  cc: "",
  hpi: "",
  investigations: "",
  activeIssuesText: "",
  managementPlanText: ""
};

function splitToList(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createPatientFromForm(form: NewPatientForm): Patient {
  const activeManagement = splitToList(form.managementPlanText);
  return {
    id: `p-${Date.now()}`,
    hospitalCode: form.hospitalCode.trim(),
    bedNumber: form.bedNumber.trim(),
    initials: form.initials.trim().toUpperCase(),
    diagnosis: form.diagnosis,
    admissionDate: form.admissionDate,
    socialHistory: form.socialHistory.trim(),
    pmh: form.pmh.trim(),
    cc: form.cc.trim(),
    hpi: form.hpi.trim(),
    investigations: form.investigations.trim(),
    activeIssues: splitToList(form.activeIssuesText),
    activeManagement,
    managementUpdates:
      activeManagement.length > 0
        ? ["Initial management plan documented on admission."]
        : ["Patient added to active dashboard."]
  };
}

function readPatientsFromStorage(key: string): Patient[] | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((entry): Patient => {
      const patient = entry as Partial<Patient>;
      return {
        id: patient.id ?? `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        hospitalCode: patient.hospitalCode ?? "",
        bedNumber: patient.bedNumber ?? "",
        initials: patient.initials ?? "",
        diagnosis: Array.isArray(patient.diagnosis)
          ? patient.diagnosis
          : patient.diagnosis
          ? [patient.diagnosis as unknown as string]
          : patient.activeIssues?.[0]
          ? [patient.activeIssues[0]]
          : ["Not specified"],
        admissionDate: patient.admissionDate ?? "",
        socialHistory: patient.socialHistory ?? "",
        pmh: patient.pmh ?? "",
        cc: patient.cc ?? "",
        hpi: patient.hpi ?? "",
        investigations: patient.investigations ?? "",
        activeIssues: patient.activeIssues ?? [],
        activeManagement: patient.activeManagement ?? [],
        managementUpdates: patient.managementUpdates ?? [],
        dischargeDate: patient.dischargeDate
      };
    });
  } catch {
    return null;
  }
}

export default function Home() {
  const [activePatients, setActivePatients] = useState<Patient[]>([]);
  const [dischargedPatients, setDischargedPatients] = useState<Patient[]>([]);
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [expandedDischargedIds, setExpandedDischargedIds] = useState<Record<string, boolean>>({});
  const [isNewPatientOpen, setIsNewPatientOpen] = useState(false);
  const [isDischargeOpen, setIsDischargeOpen] = useState(false);
  const [newPatientForm, setNewPatientForm] = useState<NewPatientForm>(emptyPatientForm);
  const [selectedDischargeId, setSelectedDischargeId] = useState("");
  const [managementDrafts, setManagementDrafts] = useState<Record<string, string>>({});
  const [showManagementInput, setShowManagementInput] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [completedManagement, setCompletedManagement] = useState<Record<string, Set<number>>>({});
  const [editingFields, setEditingFields] = useState<Record<string, Record<string, boolean>>>({});
  const [editDrafts, setEditDrafts] = useState<Record<string, Record<string, string>>>({});
  const [spaceCSort, setSpaceCSort] = useState<"bed" | "admission">("bed");
  const [spaceBSort, setSpaceBSort] = useState<"bed-asc" | "diagnosis">("bed-asc");
  const [diagnosisInput, setDiagnosisInput] = useState("");
  const [diagnosisDraftTags, setDiagnosisDraftTags] = useState<Record<string, string[]>>({});
  const [diagnosisEditInput, setDiagnosisEditInput] = useState<Record<string, string>>({});
  const [dischargeSearch, setDischargeSearch] = useState("");
  const undoTimerRef = useRef<number | null>(null);
  const patientCardRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(
    () => () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const storedActivePatients = readPatientsFromStorage(ACTIVE_PATIENTS_STORAGE_KEY);
    const storedDischargedPatients = readPatientsFromStorage(DISCHARGED_PATIENTS_STORAGE_KEY);

    const storedCompletedRaw = window.localStorage.getItem(COMPLETED_MANAGEMENT_STORAGE_KEY);
    const storedCompleted: Record<string, Set<number>> = {};
    if (storedCompletedRaw) {
      try {
        const parsed = JSON.parse(storedCompletedRaw) as Record<string, number[]>;
        Object.entries(parsed).forEach(([patientId, indices]) => {
          storedCompleted[patientId] = new Set(indices);
        });
      } catch {
        // If parsing fails, start with empty object
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActivePatients(storedActivePatients ?? initialActivePatients);
    setDischargedPatients(storedDischargedPatients ?? []);
    setCompletedManagement(storedCompleted);
    setIsStorageReady(true);
  }, []);

  useEffect(() => {
    if (!isStorageReady || typeof window === "undefined") return;

    window.localStorage.setItem(
      ACTIVE_PATIENTS_STORAGE_KEY,
      JSON.stringify(activePatients)
    );
    window.localStorage.setItem(
      DISCHARGED_PATIENTS_STORAGE_KEY,
      JSON.stringify(dischargedPatients)
    );

    const completedForStorage = Object.entries(completedManagement).reduce(
      (acc, [patientId, indices]) => {
        if (indices.size > 0) {
          acc[patientId] = Array.from(indices);
        }
        return acc;
      },
      {} as Record<string, number[]>
    );
    window.localStorage.setItem(
      COMPLETED_MANAGEMENT_STORAGE_KEY,
      JSON.stringify(completedForStorage)
    );
  }, [activePatients, dischargedPatients, completedManagement, isStorageReady]);

  const sortedBeds = useMemo(
    () =>
      activePatients
        .map((patient) => patient.bedNumber)
        .sort((a, b) => {
          const numA = Number(a);
          const numB = Number(b);
          const aIsNum = !Number.isNaN(numA) && a.trim() !== "";
          const bIsNum = !Number.isNaN(numB) && b.trim() !== "";
          if (aIsNum && bIsNum) return numA - numB;
          if (aIsNum) return -1;
          if (bIsNum) return 1;
          return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
        }),
    [activePatients]
  );

  const togglePatient = (patientId: string) => {
    setExpandedIds((prev) => ({ ...prev, [patientId]: !prev[patientId] }));
  };

  const toggleDischargedPatient = (patientId: string) => {
    setExpandedDischargedIds((prev) => ({ ...prev, [patientId]: !prev[patientId] }));
  };

  const handleNewPatientSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const patient = createPatientFromForm(newPatientForm);
    setActivePatients((prev) => [patient, ...prev]);
    setExpandedIds((prev) => ({ ...prev, [patient.id]: true }));
    setNewPatientForm(emptyPatientForm);
    setDiagnosisInput("");
    setIsNewPatientOpen(false);
  };

  const handleDischarge = () => {
    if (!selectedDischargeId) return;

    const patient = activePatients.find((item) => item.id === selectedDischargeId);
    if (!patient) return;

    const dischargeDate = new Date().toISOString().slice(0, 10);
    setActivePatients((prev) => prev.filter((item) => item.id !== selectedDischargeId));
    setDischargedPatients((prev) => [
      {
        ...patient,
        dischargeDate,
        managementUpdates: [
          `Discharged on ${dischargeDate}.`,
          ...patient.managementUpdates
        ]
      },
      ...prev
    ]);
    setExpandedDischargedIds((prev) => ({ ...prev, [selectedDischargeId]: true }));
    setSelectedDischargeId("");
    setIsDischargeOpen(false);
  };

  const addManagementUpdate = (patientId: string) => {
    const draft = (managementDrafts[patientId] ?? "").trim();
    if (!draft) return;

    const today = new Date().toLocaleDateString();
    setActivePatients((prev) =>
      prev.map((patient) =>
        patient.id === patientId
          ? {
              ...patient,
              activeManagement: [...patient.activeManagement, draft],
              managementUpdates: [`${today}: ${draft}`, ...patient.managementUpdates]
            }
          : patient
      )
    );

    setManagementDrafts((prev) => ({ ...prev, [patientId]: "" }));
    setShowManagementInput((prev) => ({ ...prev, [patientId]: false }));
  };

  const toggleManagementCompletion = (patientId: string, index: number) => {
    setCompletedManagement((prev) => {
      const patientCompleted = prev[patientId] ?? new Set();
      const updated = new Set(patientCompleted);
      if (updated.has(index)) {
        updated.delete(index);
      } else {
        updated.add(index);
      }
      return { ...prev, [patientId]: updated };
    });
  };

  const toggleFieldEdit = (patientId: string, fieldName: string) => {
    const patient = activePatients.find((p) => p.id === patientId);
    if (!patient) return;

    const fieldValue = patient[fieldName as keyof Patient] as string;
    setEditingFields((prev) => ({
      ...prev,
      [patientId]: { ...prev[patientId], [fieldName]: !prev[patientId]?.[fieldName] }
    }));

    if (!editingFields[patientId]?.[fieldName]) {
      setEditDrafts((prev) => ({
        ...prev,
        [patientId]: { ...prev[patientId], [fieldName]: fieldValue }
      }));
    }
  };

  const deleteActivePatient = (patientId: string) => {
    const removedIndex = activePatients.findIndex((patient) => patient.id === patientId);
    if (removedIndex < 0) return;

    const removedPatient = activePatients[removedIndex];
    setActivePatients((prev) => prev.filter((patient) => patient.id !== patientId));
    setExpandedIds((prev) => {
      const next = { ...prev };
      delete next[patientId];
      return next;
    });
    setManagementDrafts((prev) => {
      const next = { ...prev };
      delete next[patientId];
      return next;
    });
    setShowManagementInput((prev) => {
      const next = { ...prev };
      delete next[patientId];
      return next;
    });
    setCompletedManagement((prev) => {
      const next = { ...prev };
      delete next[patientId];
      return next;
    });
    setEditingFields((prev) => {
      const next = { ...prev };
      delete next[patientId];
      return next;
    });
    setEditDrafts((prev) => {
      const next = { ...prev };
      delete next[patientId];
      return next;
    });
    setSelectedDischargeId((prev) => (prev === patientId ? "" : prev));

    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }

    setPendingDelete({ patient: removedPatient, index: removedIndex, source: "active" });
    undoTimerRef.current = window.setTimeout(() => {
      setPendingDelete(null);
      undoTimerRef.current = null;
    }, 6000);
  };

  const deleteDischargedPatient = (patientId: string) => {
    const removedIndex = dischargedPatients.findIndex((patient) => patient.id === patientId);
    if (removedIndex < 0) return;

    const removedPatient = dischargedPatients[removedIndex];
    setDischargedPatients((prev) => prev.filter((patient) => patient.id !== patientId));
    setExpandedDischargedIds((prev) => {
      const next = { ...prev };
      delete next[patientId];
      return next;
    });
    setCompletedManagement((prev) => {
      const next = { ...prev };
      delete next[patientId];
      return next;
    });
    setEditingFields((prev) => {
      const next = { ...prev };
      delete next[patientId];
      return next;
    });
    setEditDrafts((prev) => {
      const next = { ...prev };
      delete next[patientId];
      return next;
    });

    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }

    setPendingDelete({ patient: removedPatient, index: removedIndex, source: "discharged" });
    undoTimerRef.current = window.setTimeout(() => {
      setPendingDelete(null);
      undoTimerRef.current = null;
    }, 6000);
  };

  const undoDeletePatient = () => {
    if (!pendingDelete) return;

    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }

    if (pendingDelete.source === "active") {
      setActivePatients((prev) => {
        if (prev.some((patient) => patient.id === pendingDelete.patient.id)) {
          return prev;
        }

        const next = [...prev];
        const insertionIndex = Math.min(pendingDelete.index, next.length);
        next.splice(insertionIndex, 0, pendingDelete.patient);
        return next;
      });
    } else {
      setDischargedPatients((prev) => {
        if (prev.some((patient) => patient.id === pendingDelete.patient.id)) {
          return prev;
        }

        const next = [...prev];
        const insertionIndex = Math.min(pendingDelete.index, next.length);
        next.splice(insertionIndex, 0, pendingDelete.patient);
        return next;
      });
    }

    setPendingDelete(null);
  };

  return (
    <main className="rounds-shell">
      <div className="outpatient-back-row">
        <Link href="/" className="ghost-btn outpatient-back-btn">
          ← Back to Main Dashboard
        </Link>
      </div>

      <section className="hero-band">
        <div>
          <p className="eyebrow">Inpatient Daily Round Dashboard</p>
          <h1>Doctor Round Command Center</h1>
          <p className="hero-caption">
            Track active and discharged patients with immediate access to issues,
            investigations, and management changes.
          </p>
        </div>

        <div className="hero-actions">
          <button className="primary-btn" onClick={() => setIsNewPatientOpen(true)}>
            New patient
          </button>
          <button className="danger-btn" onClick={() => setIsDischargeOpen(true)}>
            Discharge patient
          </button>
        </div>
      </section>

      <section className="panel space-a">
        <header className="section-title">
          <h2>Current Patients</h2>
          <span className="count-pill">Active cases: {activePatients.length}</span>
        </header>

        <div className="beds-grid">
          {sortedBeds.length === 0 ? (
            <p className="muted-text">No active beds right now.</p>
          ) : (
            sortedBeds.map((bed) => (
              <button
                className="bed-tile bed-tile-btn"
                key={`bed-${bed}`}
                onClick={() => {
                  const patient = activePatients.find((p) => p.bedNumber === bed);
                  if (!patient) return;
                  setExpandedIds((prev) => ({ ...prev, [patient.id]: true }));
                  setTimeout(() => {
                    patientCardRefs.current[patient.id]?.scrollIntoView({
                      behavior: "smooth",
                      block: "start"
                    });
                  }, 50);
                }}
              >
                <div className="bed-icon" aria-hidden="true">
                  🛏
                </div>
                <div>
                  <p className="bed-label">Bed {bed}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <header className="section-title">
          <h2>Master List</h2>
          <div className="sort-controls">
            <span className="sort-label">Sort by:</span>
            <button
              className={`sort-btn${spaceBSort === "bed-asc" ? " active" : ""}`}
              onClick={() => setSpaceBSort("bed-asc")}
            >
              Bed
            </button>
            <button
              className={`sort-btn${spaceBSort === "diagnosis" ? " active" : ""}`}
              onClick={() => setSpaceBSort("diagnosis")}
            >
              Diagnosis
            </button>
          </div>
        </header>

        <div className="table-wrap">
          <table className="summary-table">
            <thead>
              <tr>
                <th>Bed</th>
                <th>Patient</th>
                <th>Diagnosis</th>
                <th>Active issues</th>
                <th>Active management</th>
                <th>Latest change in management</th>
              </tr>
            </thead>
            <tbody>
              {activePatients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No active patients.
                  </td>
                </tr>
              ) : (
                [...activePatients]
                  .sort((a, b) => {
                    if (spaceBSort === "bed-asc") {
                      const numA = Number(a.bedNumber);
                      const numB = Number(b.bedNumber);
                      const aIsNum = !Number.isNaN(numA) && a.bedNumber.trim() !== "";
                      const bIsNum = !Number.isNaN(numB) && b.bedNumber.trim() !== "";
                      if (aIsNum && bIsNum) return numA - numB;
                      if (aIsNum) return -1;
                      if (bIsNum) return 1;
                      return a.bedNumber.localeCompare(b.bedNumber, undefined, { numeric: true, sensitivity: "base" });
                    }
                    // sort by first diagnosis tag alphabetically
                    const tagA = a.diagnosis[0] ?? "";
                    const tagB = b.diagnosis[0] ?? "";
                    return tagA.localeCompare(tagB);
                  })
                  .map((patient) => (
                  <tr key={patient.id}>
                    <td>{patient.bedNumber}</td>
                    <td>
                      {patient.initials}
                      <br />
                      <span className="subtle">{patient.hospitalCode}</span>
                    </td>
                    <td>
                      <div className="diagnosis-tags-wrap">
                        {patient.diagnosis.map((tag, index) => (
                          <span key={`${patient.id}-diag-${index}`} className="diagnosis-tag diagnosis-tag-sm">{tag}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <ul className="compact-list">
                        {patient.activeIssues.map((issue, index) => (
                          <li key={`${patient.id}-issue-${index}`}>{issue}</li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      <ul className="compact-list">
                        {patient.activeManagement.map((plan, index) => (
                          <li key={`${patient.id}-plan-${index}`}>{plan}</li>
                        ))}
                      </ul>
                    </td>
                    <td>{patient.managementUpdates[0] ?? "No changes yet."}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <header className="section-title">
          <h2>Patients Details</h2>
          <div className="sort-controls">
            <span className="sort-label">Sort by:</span>
            <button
              className={`sort-btn${spaceCSort === "bed" ? " active" : ""}`}
              onClick={() => setSpaceCSort("bed")}
            >
              Bed No.
            </button>
            <button
              className={`sort-btn${spaceCSort === "admission" ? " active" : ""}`}
              onClick={() => setSpaceCSort("admission")}
            >
              Admission Date
            </button>
          </div>
        </header>

        <div className="patient-list">
          {activePatients.length === 0 ? (
            <p className="muted-text">No active patients available.</p>
          ) : (
            [...activePatients]
              .sort((a, b) => {
                if (spaceCSort === "bed") {
                  const numA = Number(a.bedNumber);
                  const numB = Number(b.bedNumber);
                  const aIsNum = !Number.isNaN(numA) && a.bedNumber.trim() !== "";
                  const bIsNum = !Number.isNaN(numB) && b.bedNumber.trim() !== "";
                  if (aIsNum && bIsNum) return numA - numB;
                  if (aIsNum) return -1;
                  if (bIsNum) return 1;
                  return a.bedNumber.localeCompare(b.bedNumber, undefined, { numeric: true, sensitivity: "base" });
                }
                return new Date(a.admissionDate).getTime() - new Date(b.admissionDate).getTime();
              })
              .map((patient) => {
                const isExpanded = Boolean(expandedIds[patient.id]);
                const showDraft = Boolean(showManagementInput[patient.id]);

              return (
                <article
                  className="patient-card"
                  key={patient.id}
                  ref={(el) => { patientCardRefs.current[patient.id] = el; }}
                >
                  <div className="patient-header-row">
                    <button
                      className="patient-toggle"
                      onClick={() => togglePatient(patient.id)}
                      aria-expanded={isExpanded}
                    >
                      <span className="patient-toggle-summary">
                        <span>Bed {patient.bedNumber} | {patient.initials} | {patient.hospitalCode} | {patient.admissionDate}</span>
                        {patient.diagnosis.length > 0 && (
                          <span className="toggle-diagnosis-tags">
                            {patient.diagnosis.map((tag, i) => (
                              <span key={i} className="diagnosis-tag diagnosis-tag-sm">{tag}</span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="toggle-mark">{isExpanded ? "-" : "+"}</span>
                    </button>

                    <button
                      className="delete-mini-btn"
                      onClick={() => {
                        const shouldDelete = window.confirm(
                          `Delete patient ${patient.initials} in Bed ${patient.bedNumber}?`
                        );
                        if (shouldDelete) {
                          deleteActivePatient(patient.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="patient-grid">
                      <div className="left-column">
                        <div className="detail-row">
                          <div className="detail-row-header">
                            <h3>Social History and PMH</h3>
                            {!editingFields[patient.id]?.socialHistory && (
                              <button
                                className="edit-btn"
                                onClick={() => toggleFieldEdit(patient.id, "socialHistory")}
                              >
                                Edit
                              </button>
                            )}
                          </div>
                          {editingFields[patient.id]?.socialHistory ? (
                            <div className="edit-field">
                              <textarea
                                value={editDrafts[patient.id]?.socialHistory ?? patient.socialHistory}
                                onChange={(e) =>
                                  setEditDrafts((prev) => ({
                                    ...prev,
                                    [patient.id]: { ...prev[patient.id], socialHistory: e.target.value }
                                  }))
                                }
                                placeholder="Social History"
                              />
                              <textarea
                                value={editDrafts[patient.id]?.pmh ?? patient.pmh}
                                onChange={(e) =>
                                  setEditDrafts((prev) => ({
                                    ...prev,
                                    [patient.id]: { ...prev[patient.id], pmh: e.target.value }
                                  }))
                                }
                                placeholder="PMH"
                              />
                              <div className="edit-actions">
                                <button
                                  className="primary-btn small"
                                  onClick={() => {
                                    setActivePatients((prev) =>
                                      prev.map((p) =>
                                        p.id === patient.id
                                          ? {
                                              ...p,
                                              socialHistory: editDrafts[patient.id]?.socialHistory ?? patient.socialHistory,
                                              pmh: editDrafts[patient.id]?.pmh ?? patient.pmh
                                            }
                                          : p
                                      )
                                    );
                                    setEditingFields((prev) => ({
                                      ...prev,
                                      [patient.id]: { ...prev[patient.id], socialHistory: false }
                                    }));
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  className="secondary-btn small"
                                  onClick={() =>
                                    setEditingFields((prev) => ({
                                      ...prev,
                                      [patient.id]: { ...prev[patient.id], socialHistory: false }
                                    }))
                                  }
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="view-field">
                              <p><strong>Social:</strong> {patient.socialHistory}</p>
                              <p><strong>PMH:</strong> {patient.pmh}</p>
                            </div>
                          )}
                        </div>

                        <div className="detail-row">
                          <div className="detail-row-header">
                            <h3>CC and HPI</h3>
                            {!editingFields[patient.id]?.cc && (
                              <button
                                className="edit-btn"
                                onClick={() => toggleFieldEdit(patient.id, "cc")}
                              >
                                Edit
                              </button>
                            )}
                          </div>
                          {editingFields[patient.id]?.cc ? (
                            <div className="edit-field">
                              <textarea
                                value={editDrafts[patient.id]?.cc ?? patient.cc}
                                onChange={(e) =>
                                  setEditDrafts((prev) => ({
                                    ...prev,
                                    [patient.id]: { ...prev[patient.id], cc: e.target.value }
                                  }))
                                }
                                placeholder="Chief Complaint"
                              />
                              <textarea
                                value={editDrafts[patient.id]?.hpi ?? patient.hpi}
                                onChange={(e) =>
                                  setEditDrafts((prev) => ({
                                    ...prev,
                                    [patient.id]: { ...prev[patient.id], hpi: e.target.value }
                                  }))
                                }
                                placeholder="History of Present Illness"
                              />
                              <div className="edit-actions">
                                <button
                                  className="primary-btn small"
                                  onClick={() => {
                                    setActivePatients((prev) =>
                                      prev.map((p) =>
                                        p.id === patient.id
                                          ? {
                                              ...p,
                                              cc: editDrafts[patient.id]?.cc ?? patient.cc,
                                              hpi: editDrafts[patient.id]?.hpi ?? patient.hpi
                                            }
                                          : p
                                      )
                                    );
                                    setEditingFields((prev) => ({
                                      ...prev,
                                      [patient.id]: { ...prev[patient.id], cc: false }
                                    }));
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  className="secondary-btn small"
                                  onClick={() =>
                                    setEditingFields((prev) => ({
                                      ...prev,
                                      [patient.id]: { ...prev[patient.id], cc: false }
                                    }))
                                  }
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="view-field">
                              <p><strong>CC:</strong> {patient.cc}</p>
                              <p><strong>HPI:</strong> {patient.hpi}</p>
                            </div>
                          )}
                        </div>

                        <div className="detail-row">
                          <div className="detail-row-header">
                            <h3>Important Investigation Results</h3>
                            {!editingFields[patient.id]?.investigations && (
                              <button
                                className="edit-btn"
                                onClick={() => toggleFieldEdit(patient.id, "investigations")}
                              >
                                Edit
                              </button>
                            )}
                          </div>
                          {editingFields[patient.id]?.investigations ? (
                            <div className="edit-field">
                              <textarea
                                value={editDrafts[patient.id]?.investigations ?? patient.investigations}
                                onChange={(e) =>
                                  setEditDrafts((prev) => ({
                                    ...prev,
                                    [patient.id]: { ...prev[patient.id], investigations: e.target.value }
                                  }))
                                }
                                placeholder="Investigation Results"
                              />
                              <div className="edit-actions">
                                <button
                                  className="primary-btn small"
                                  onClick={() => {
                                    setActivePatients((prev) =>
                                      prev.map((p) =>
                                        p.id === patient.id
                                          ? {
                                              ...p,
                                              investigations: editDrafts[patient.id]?.investigations ?? patient.investigations
                                            }
                                          : p
                                      )
                                    );
                                    setEditingFields((prev) => ({
                                      ...prev,
                                      [patient.id]: { ...prev[patient.id], investigations: false }
                                    }));
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  className="secondary-btn small"
                                  onClick={() =>
                                    setEditingFields((prev) => ({
                                      ...prev,
                                      [patient.id]: { ...prev[patient.id], investigations: false }
                                    }))
                                  }
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="view-field">
                              <p>{patient.investigations}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="right-column">
                        <div className="detail-row diagnosis-row">
                            <div className="detail-row-header">
                              <h3>Diagnosis</h3>
                              <button
                                className="edit-btn"
                                onClick={() => {
                                  const isEditing = editingFields[patient.id]?.["diagnosis"];
                                  if (!isEditing) {
                                    setDiagnosisDraftTags((prev) => ({ ...prev, [patient.id]: [...patient.diagnosis] }));
                                    setDiagnosisEditInput((prev) => ({ ...prev, [patient.id]: "" }));
                                  }
                                  setEditingFields((prev) => ({
                                    ...prev,
                                    [patient.id]: { ...prev[patient.id], diagnosis: !isEditing }
                                  }));
                                }}
                              >
                                {editingFields[patient.id]?.["diagnosis"] ? "Cancel" : "Edit"}
                              </button>
                            </div>
                            {editingFields[patient.id]?.["diagnosis"] ? (
                              <>
                                <div className="tag-input-wrap">
                                  {(diagnosisDraftTags[patient.id] ?? []).map((tag, i) => (
                                    <span key={i} className="diagnosis-tag">
                                      {tag}
                                      <button
                                        type="button"
                                        className="tag-remove"
                                        onClick={() =>
                                          setDiagnosisDraftTags((prev) => ({
                                            ...prev,
                                            [patient.id]: prev[patient.id].filter((_, idx) => idx !== i)
                                          }))
                                        }
                                      >
                                        ×
                                      </button>
                                    </span>
                                  ))}
                                  <input
                                    className="tag-text-input"
                                    value={diagnosisEditInput[patient.id] ?? ""}
                                    placeholder="Type a tag and press Enter"
                                    onChange={(e) =>
                                      setDiagnosisEditInput((prev) => ({ ...prev, [patient.id]: e.target.value }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === ",") {
                                        e.preventDefault();
                                        const tag = (diagnosisEditInput[patient.id] ?? "").trim().replace(/,$/, "");
                                        if (tag && !(diagnosisDraftTags[patient.id] ?? []).includes(tag)) {
                                          setDiagnosisDraftTags((prev) => ({
                                            ...prev,
                                            [patient.id]: [...(prev[patient.id] ?? []), tag]
                                          }));
                                        }
                                        setDiagnosisEditInput((prev) => ({ ...prev, [patient.id]: "" }));
                                      } else if (
                                        e.key === "Backspace" &&
                                        (diagnosisEditInput[patient.id] ?? "") === "" &&
                                        (diagnosisDraftTags[patient.id] ?? []).length > 0
                                      ) {
                                        setDiagnosisDraftTags((prev) => ({
                                          ...prev,
                                          [patient.id]: prev[patient.id].slice(0, -1)
                                        }));
                                      }
                                    }}
                                  />
                                </div>
                                <div className="edit-actions">
                                  <button
                                    className="primary-btn small"
                                    onClick={() => {
                                      setActivePatients((prev) =>
                                        prev.map((p) =>
                                          p.id === patient.id
                                            ? { ...p, diagnosis: diagnosisDraftTags[patient.id] ?? [] }
                                            : p
                                        )
                                      );
                                      setEditingFields((prev) => ({
                                        ...prev,
                                        [patient.id]: { ...prev[patient.id], diagnosis: false }
                                      }));
                                    }}
                                  >
                                    Save
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="diagnosis-tags-wrap">
                                {patient.diagnosis.map((tag, i) => (
                                  <span key={i} className="diagnosis-tag">{tag}</span>
                                ))}
                                {patient.diagnosis.length === 0 && <span className="muted-text">No tags.</span>}
                              </div>
                            )}
                          </div>

                        <div className="detail-row">
                          <h3>Active Management</h3>
                          <ul className="detail-list">
                            {patient.activeManagement.map((entry, index) => {
                              const isCompleted = completedManagement[patient.id]?.has(index) ?? false;
                              const editKey = `activeManagement-${index}`;
                              const isEditing = editingFields[patient.id]?.[editKey];
                              return (
                                <li key={`${patient.id}-active-mgmt-${index}`}>
                                  {isEditing ? (
                                    <div className="management-edit">
                                      <input
                                        type="text"
                                        value={editDrafts[patient.id]?.[editKey] ?? entry}
                                        onChange={(e) =>
                                          setEditDrafts((prev) => ({
                                            ...prev,
                                            [patient.id]: { ...prev[patient.id], [editKey]: e.target.value }
                                          }))
                                        }
                                      />
                                      <button
                                        className="primary-btn small"
                                        onClick={() => {
                                          const newValue = editDrafts[patient.id]?.[editKey] ?? entry;
                                          setActivePatients((prev) =>
                                            prev.map((p) =>
                                              p.id === patient.id
                                                ? {
                                                    ...p,
                                                    activeManagement: p.activeManagement.map((item, i) =>
                                                      i === index ? newValue : item
                                                    )
                                                  }
                                                : p
                                            )
                                          );
                                          setEditingFields((prev) => ({
                                            ...prev,
                                            [patient.id]: { ...prev[patient.id], [editKey]: false }
                                          }));
                                        }}
                                      >
                                        Save
                                      </button>
                                      <button
                                        className="secondary-btn small"
                                        onClick={() =>
                                          setEditingFields((prev) => ({
                                            ...prev,
                                            [patient.id]: { ...prev[patient.id], [editKey]: false }
                                          }))
                                        }
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <label className="management-item">
                                      <span className={isCompleted ? "completed" : ""}>{entry}</span>
                                      <div className="management-actions">
                                        <input
                                          type="checkbox"
                                          checked={isCompleted}
                                          onChange={() => toggleManagementCompletion(patient.id, index)}
                                        />
                                        <button
                                          className="edit-btn"
                                          onClick={() => {
                                            setEditDrafts((prev) => ({
                                              ...prev,
                                              [patient.id]: { ...prev[patient.id], [editKey]: entry }
                                            }));
                                            setEditingFields((prev) => ({
                                              ...prev,
                                              [patient.id]: { ...prev[patient.id], [editKey]: true }
                                            }));
                                          }}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          className="danger-btn-small"
                                          onClick={() => {
                                            if (confirm("Remove this management item?")) {
                                              setActivePatients((prev) =>
                                                prev.map((p) =>
                                                  p.id === patient.id
                                                    ? {
                                                        ...p,
                                                        activeManagement: p.activeManagement.filter((_, i) => i !== index)
                                                      }
                                                    : p
                                                )
                                              );
                                            }
                                          }}
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </label>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>

                        <div className="detail-row">
                          <h3>Latest New / Change in Management</h3>
                          <ul className="detail-list">
                            {patient.managementUpdates.map((entry, index) => (
                              <li key={`${patient.id}-mgmt-update-${index}`}>{entry}</li>
                            ))}
                          </ul>

                          <div className="inline-actions">
                            <button
                              className="secondary-btn"
                              onClick={() =>
                                setShowManagementInput((prev) => ({
                                  ...prev,
                                  [patient.id]: !prev[patient.id]
                                }))
                              }
                            >
                              New management
                            </button>
                          </div>

                          {showDraft && (
                            <div className="management-editor">
                              <textarea
                                value={managementDrafts[patient.id] ?? ""}
                                onChange={(event) =>
                                  setManagementDrafts((prev) => ({
                                    ...prev,
                                    [patient.id]: event.target.value
                                  }))
                                }
                                placeholder="Enter new management for this patient"
                              />
                              <button
                                className="primary-btn small"
                                onClick={() => addManagementUpdate(patient.id)}
                              >
                                Add update
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="panel">
        <header className="section-title">
          <h2>Discharged Patients</h2>
          <span className="count-pill muted">Discharged: {dischargedPatients.length}</span>
        </header>

        {dischargedPatients.length > 0 && (
          <div className="discharge-search-wrap">
            <input
              className="discharge-search-input"
              type="text"
              placeholder="Search by diagnosis tag…"
              value={dischargeSearch}
              onChange={(e) => setDischargeSearch(e.target.value)}
            />
            {dischargeSearch && (
              <button className="ghost-btn" onClick={() => setDischargeSearch("")}>Clear</button>
            )}
          </div>
        )}

        <div className="discharge-grid">
          {dischargedPatients.length === 0 ? (
            <p className="muted-text">No discharged patients yet.</p>
          ) : (
            (() => {
              const query = dischargeSearch.trim().toLowerCase();
              const filtered = query
                ? dischargedPatients.filter((p) =>
                    p.diagnosis.some((tag) => tag.toLowerCase().includes(query))
                  )
                : dischargedPatients;
              if (filtered.length === 0) {
                return <p className="muted-text">No discharged patients match &ldquo;{dischargeSearch}&rdquo;.</p>;
              }
              return filtered.map((patient) => (
              <article className="discharged-card" key={`discharged-${patient.id}`}>
                <div className="discharged-card-header">
                  <button
                    className="discharged-toggle"
                    onClick={() => toggleDischargedPatient(patient.id)}
                    aria-expanded={Boolean(expandedDischargedIds[patient.id])}
                  >
                    <span>
                      <strong>{patient.initials}</strong> | {patient.hospitalCode} | {patient.diagnosis.map((tag, i) => (
                        <span key={i} className="diagnosis-tag diagnosis-tag-sm">{tag}</span>
                      ))}
                    </span>
                    <span className="toggle-mark">
                      {expandedDischargedIds[patient.id] ? "-" : "+"}
                    </span>
                  </button>
                  <button
                    className="delete-mini-btn"
                    onClick={() => {
                      const shouldDelete = window.confirm(
                        `Delete discharged profile ${patient.initials} in Bed ${patient.bedNumber}?`
                      );
                      if (shouldDelete) {
                        deleteDischargedPatient(patient.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
                {expandedDischargedIds[patient.id] && (
                  <div className="discharged-detail">
                    <p>
                      <strong>Admitted:</strong> {patient.admissionDate} &nbsp;|&nbsp; <strong>Discharged:</strong>{" "}
                      {patient.dischargeDate}
                    </p>
                    {(patient.cc || patient.hpi) && (
                      <div className="discharged-section">
                        <strong>CC / HPI</strong>
                        <p className="pre-wrap">{[patient.cc, patient.hpi].filter(Boolean).join("\n")}</p>
                      </div>
                    )}
                    {patient.investigations && (
                      <div className="discharged-section">
                        <strong>Investigations</strong>
                        <p className="pre-wrap">{patient.investigations}</p>
                      </div>
                    )}
                    {patient.activeManagement.length > 0 && (
                      <div className="discharged-section">
                        <strong>Management done</strong>
                        <ul className="compact-list">
                          {patient.activeManagement.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </article>
            ));
            })()
          )}
        </div>
      </section>

      {isNewPatientOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <header>
              <h2>New patient</h2>
              <button className="ghost-btn" onClick={() => setIsNewPatientOpen(false)}>
                Close
              </button>
            </header>

            <form className="patient-form" onSubmit={handleNewPatientSubmit}>
              <label>
                Hospital code number
                <input
                  required
                  value={newPatientForm.hospitalCode}
                  onChange={(event) =>
                    setNewPatientForm((prev) => ({ ...prev, hospitalCode: event.target.value }))
                  }
                />
              </label>

              <label>
                Bed number
                <input
                  required
                  value={newPatientForm.bedNumber}
                  onChange={(event) =>
                    setNewPatientForm((prev) => ({ ...prev, bedNumber: event.target.value }))
                  }
                />
              </label>

              <label>
                Patient initials
                <input
                  required
                  value={newPatientForm.initials}
                  onChange={(event) =>
                    setNewPatientForm((prev) => ({ ...prev, initials: event.target.value }))
                  }
                />
              </label>

              <div className="form-field">
                <span className="form-field-label">Diagnosis Tags</span>
                <div className="tag-input-wrap">
                  {newPatientForm.diagnosis.map((tag, i) => (
                    <span key={i} className="diagnosis-tag">
                      {tag}
                      <button
                        type="button"
                        className="tag-remove"
                        onClick={() =>
                          setNewPatientForm((prev) => ({
                            ...prev,
                            diagnosis: prev.diagnosis.filter((_, idx) => idx !== i)
                          }))
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    className="tag-text-input"
                    value={diagnosisInput}
                    placeholder="Type a tag and press Enter"
                    onChange={(e) => setDiagnosisInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const tag = diagnosisInput.trim().replace(/,$/, "");
                        if (tag && !newPatientForm.diagnosis.includes(tag)) {
                          setNewPatientForm((prev) => ({
                            ...prev,
                            diagnosis: [...prev.diagnosis, tag]
                          }));
                        }
                        setDiagnosisInput("");
                      } else if (e.key === "Backspace" && diagnosisInput === "" && newPatientForm.diagnosis.length > 0) {
                        setNewPatientForm((prev) => ({
                          ...prev,
                          diagnosis: prev.diagnosis.slice(0, -1)
                        }));
                      }
                    }}
                  />
                </div>
              </div>

              <label>
                Admission date
                <input
                  type="date"
                  required
                  value={newPatientForm.admissionDate}
                  onChange={(event) =>
                    setNewPatientForm((prev) => ({ ...prev, admissionDate: event.target.value }))
                  }
                />
              </label>

              <label>
                Social history
                <textarea
                  required
                  value={newPatientForm.socialHistory}
                  onChange={(event) =>
                    setNewPatientForm((prev) => ({ ...prev, socialHistory: event.target.value }))
                  }
                />
              </label>

              <label>
                Past medical history (PMH)
                <textarea
                  required
                  value={newPatientForm.pmh}
                  onChange={(event) =>
                    setNewPatientForm((prev) => ({ ...prev, pmh: event.target.value }))
                  }
                />
              </label>

              <label>
                Chief complaints (CC)
                <textarea
                  required
                  value={newPatientForm.cc}
                  onChange={(event) =>
                    setNewPatientForm((prev) => ({ ...prev, cc: event.target.value }))
                  }
                />
              </label>

              <label>
                History of present illness (HPI)
                <textarea
                  required
                  value={newPatientForm.hpi}
                  onChange={(event) =>
                    setNewPatientForm((prev) => ({ ...prev, hpi: event.target.value }))
                  }
                />
              </label>

              <label>
                Important investigation results
                <textarea
                  required
                  value={newPatientForm.investigations}
                  onChange={(event) =>
                    setNewPatientForm((prev) => ({ ...prev, investigations: event.target.value }))
                  }
                />
              </label>

              <label>
                Active issues (comma or new line separated)
                <textarea
                  required
                  value={newPatientForm.activeIssuesText}
                  onChange={(event) =>
                    setNewPatientForm((prev) => ({ ...prev, activeIssuesText: event.target.value }))
                  }
                />
              </label>

              <label>
                Management plan (comma or new line separated)
                <textarea
                  required
                  value={newPatientForm.managementPlanText}
                  onChange={(event) =>
                    setNewPatientForm((prev) => ({ ...prev, managementPlanText: event.target.value }))
                  }
                />
              </label>

              <div className="form-actions">
                <button type="button" className="ghost-btn" onClick={() => setIsNewPatientOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Add patient
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDischargeOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card compact">
            <header>
              <h2>Discharge patient</h2>
              <button className="ghost-btn" onClick={() => setIsDischargeOpen(false)}>
                Close
              </button>
            </header>

            {activePatients.length === 0 ? (
              <p className="muted-text">No active patients to discharge.</p>
            ) : (
              <>
                <label className="select-wrap">
                  Select patient (bed + initials)
                  <select
                    value={selectedDischargeId}
                    onChange={(event) => setSelectedDischargeId(event.target.value)}
                  >
                    <option value="">Choose patient</option>
                    {[...activePatients]
                      .sort((a, b) => {
                        const numA = Number(a.bedNumber);
                        const numB = Number(b.bedNumber);
                        const aIsNum = !Number.isNaN(numA) && a.bedNumber.trim() !== "";
                        const bIsNum = !Number.isNaN(numB) && b.bedNumber.trim() !== "";
                        if (aIsNum && bIsNum) return numA - numB;
                        if (aIsNum) return -1;
                        if (bIsNum) return 1;
                        return a.bedNumber.localeCompare(b.bedNumber, undefined, { numeric: true, sensitivity: "base" });
                      })
                      .map((patient) => (
                        <option key={`discharge-choice-${patient.id}`} value={patient.id}>
                          Bed {patient.bedNumber} - {patient.initials}
                        </option>
                      ))}
                  </select>
                </label>

                <div className="form-actions">
                  <button type="button" className="ghost-btn" onClick={() => setIsDischargeOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="danger-btn" onClick={handleDischarge}>
                    Discharge
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="undo-toast" role="status" aria-live="polite">
          <p>
            Deleted Bed {pendingDelete.patient.bedNumber} | {pendingDelete.patient.initials}
          </p>
          <button className="ghost-btn" onClick={undoDeletePatient}>
            Undo
          </button>
        </div>
      )}
    </main>
  );
}