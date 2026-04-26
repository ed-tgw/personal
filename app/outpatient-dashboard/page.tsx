"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

interface OutpatientRecord {
  id: string;
  hospitalCode: string;
  initials: string;
  diagnosis: string[];
  entryDate: string;
  deadlineDate: string;
  problemSummary: string;
  reviewItems: string;
}

interface OutpatientForm {
  hospitalCode: string;
  initials: string;
  diagnosis: string[];
  entryDate: string;
  deadlineDate: string;
  problemSummary: string;
  reviewItems: string;
}

interface PendingUndo {
  kind: "mark-reviewed" | "delete-reviewed";
  record: OutpatientRecord;
  fromIndex: number;
}

const TO_REVIEW_STORAGE_KEY = "outpatient.to-review.v1";
const REVIEWED_STORAGE_KEY = "outpatient.reviewed.v1";
const todayISO = new Date().toISOString().slice(0, 10);

const emptyForm: OutpatientForm = {
  hospitalCode: "",
  initials: "",
  diagnosis: [],
  entryDate: todayISO,
  deadlineDate: todayISO,
  problemSummary: "",
  reviewItems: ""
};

function normalizeDiagnosisTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((tag) => String(tag).trim())
    .filter(Boolean);
}

function readRecordsFromStorage(key: string): OutpatientRecord[] | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    return parsed.map((entry): OutpatientRecord => {
      const record = entry as Partial<OutpatientRecord>;
      return {
        id: record.id ?? `outpatient-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        hospitalCode: (record.hospitalCode ?? "").trim(),
        initials: (record.initials ?? "").trim().toUpperCase(),
        diagnosis: normalizeDiagnosisTags(record.diagnosis),
        entryDate: record.entryDate ?? todayISO,
        deadlineDate: record.deadlineDate ?? todayISO,
        problemSummary: (record.problemSummary ?? "").trim(),
        reviewItems: (record.reviewItems ?? "").trim()
      };
    });
  } catch {
    return null;
  }
}

function createRecordFromForm(form: OutpatientForm): OutpatientRecord {
  return {
    id: `outpatient-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    hospitalCode: form.hospitalCode.trim(),
    initials: form.initials.trim().toUpperCase(),
    diagnosis: form.diagnosis,
    entryDate: form.entryDate,
    deadlineDate: form.deadlineDate,
    problemSummary: form.problemSummary.trim(),
    reviewItems: form.reviewItems.trim()
  };
}

function toTimestamp(value: string): number {
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

export default function OutpatientDashboardPage() {
  const [toReview, setToReview] = useState<OutpatientRecord[]>([]);
  const [reviewed, setReviewed] = useState<OutpatientRecord[]>([]);
  const [isStorageReady, setIsStorageReady] = useState(false);

  const [expandedToReview, setExpandedToReview] = useState<Record<string, boolean>>({});
  const [expandedReviewed, setExpandedReviewed] = useState<Record<string, boolean>>({});

  const [sortMode, setSortMode] = useState<"entry" | "deadline">("deadline");
  const [reviewedSearch, setReviewedSearch] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const patientCardRefs = useRef<Record<string, HTMLElement | null>>({});

  const [isNewPatientOpen, setIsNewPatientOpen] = useState(false);
  const [newForm, setNewForm] = useState<OutpatientForm>(emptyForm);
  const [newDiagnosisInput, setNewDiagnosisInput] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<OutpatientForm | null>(null);
  const [editDiagnosisInput, setEditDiagnosisInput] = useState("");

  const [editingReviewedId, setEditingReviewedId] = useState<string | null>(null);
  const [editReviewedDraft, setEditReviewedDraft] = useState<OutpatientForm | null>(null);
  const [editReviewedDiagnosisInput, setEditReviewedDiagnosisInput] = useState("");

  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const [undoMessage, setUndoMessage] = useState("");
  const undoTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const storedToReview = readRecordsFromStorage(TO_REVIEW_STORAGE_KEY);
    const storedReviewed = readRecordsFromStorage(REVIEWED_STORAGE_KEY);
    setToReview(storedToReview ?? []);
    setReviewed(storedReviewed ?? []);
    setIsStorageReady(true);
  }, []);

  useEffect(() => {
    if (!isStorageReady || typeof window === "undefined") return;
    window.localStorage.setItem(TO_REVIEW_STORAGE_KEY, JSON.stringify(toReview));
    window.localStorage.setItem(REVIEWED_STORAGE_KEY, JSON.stringify(reviewed));
  }, [isStorageReady, reviewed, toReview]);

  const sortedToReview = useMemo(() => {
    return [...toReview].sort((a, b) => {
      if (sortMode === "entry") {
        return toTimestamp(a.entryDate) - toTimestamp(b.entryDate);
      }
      return toTimestamp(a.deadlineDate) - toTimestamp(b.deadlineDate);
    });
  }, [sortMode, toReview]);

  const filteredReviewed = useMemo(() => {
    const query = reviewedSearch.trim().toLowerCase();
    if (!query) return reviewed;
    return reviewed.filter((record) =>
      record.diagnosis.some((tag) => tag.toLowerCase().includes(query))
    );
  }, [reviewed, reviewedSearch]);

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    const days: Date[] = [];
    const current = new Date(startDate);
    while (days.length < 42) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [calendarMonth]);

  const patientsByDeadlineDate = useMemo(() => {
    const map: Record<string, OutpatientRecord[]> = {};
    toReview.forEach((record) => {
      const dateKey = record.deadlineDate;
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(record);
    });
    return map;
  }, [toReview]);

  const openUndoWindow = (nextUndo: PendingUndo, message: string) => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    setPendingUndo(nextUndo);
    setUndoMessage(message);
    undoTimerRef.current = window.setTimeout(() => {
      setPendingUndo(null);
      setUndoMessage("");
      undoTimerRef.current = null;
    }, 15000);
  };

  const undoLastAction = () => {
    if (!pendingUndo) return;

    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }

    if (pendingUndo.kind === "mark-reviewed") {
      setReviewed((prev) => prev.filter((record) => record.id !== pendingUndo.record.id));
      setToReview((prev) => {
        if (prev.some((record) => record.id === pendingUndo.record.id)) {
          return prev;
        }
        const next = [...prev];
        const insertionIndex = Math.min(pendingUndo.fromIndex, next.length);
        next.splice(insertionIndex, 0, pendingUndo.record);
        return next;
      });
    } else {
      setReviewed((prev) => {
        if (prev.some((record) => record.id === pendingUndo.record.id)) {
          return prev;
        }
        const next = [...prev];
        const insertionIndex = Math.min(pendingUndo.fromIndex, next.length);
        next.splice(insertionIndex, 0, pendingUndo.record);
        return next;
      });
    }

    setPendingUndo(null);
    setUndoMessage("");
  };

  const toggleToReviewCard = (recordId: string) => {
    setExpandedToReview((prev) => ({ ...prev, [recordId]: !prev[recordId] }));
  };

  const toggleReviewedCard = (recordId: string) => {
    setExpandedReviewed((prev) => ({ ...prev, [recordId]: !prev[recordId] }));
  };

  const handleMarkReviewed = (recordId: string) => {
    const index = toReview.findIndex((record) => record.id === recordId);
    if (index < 0) return;

    const record = toReview[index];

    setToReview((prev) => prev.filter((item) => item.id !== recordId));
    setReviewed((prev) => [record, ...prev]);
    setExpandedToReview((prev) => {
      const next = { ...prev };
      delete next[recordId];
      return next;
    });
    setExpandedReviewed((prev) => ({ ...prev, [recordId]: true }));
    if (editingId === recordId) {
      setEditingId(null);
      setEditDraft(null);
      setEditDiagnosisInput("");
    }

    openUndoWindow(
      { kind: "mark-reviewed", record, fromIndex: index },
      `Moved ${record.initials} to Reviewed.`
    );
  };

  const handleDeleteReviewed = (recordId: string) => {
    const index = reviewed.findIndex((record) => record.id === recordId);
    if (index < 0) return;

    const record = reviewed[index];
    setReviewed((prev) => prev.filter((item) => item.id !== recordId));
    setExpandedReviewed((prev) => {
      const next = { ...prev };
      delete next[recordId];
      return next;
    });

    openUndoWindow(
      { kind: "delete-reviewed", record, fromIndex: index },
      `Deleted reviewed record ${record.initials}.`
    );
  };

  const handleNewPatientSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const record = createRecordFromForm(newForm);
    setToReview((prev) => [record, ...prev]);
    setExpandedToReview((prev) => ({ ...prev, [record.id]: true }));
    setNewForm(emptyForm);
    setNewDiagnosisInput("");
    setIsNewPatientOpen(false);
  };

  const startEditing = (record: OutpatientRecord) => {
    setEditingId(record.id);
    setEditDraft({
      hospitalCode: record.hospitalCode,
      initials: record.initials,
      diagnosis: [...record.diagnosis],
      entryDate: record.entryDate,
      deadlineDate: record.deadlineDate,
      problemSummary: record.problemSummary,
      reviewItems: record.reviewItems
    });
    setEditDiagnosisInput("");
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditDraft(null);
    setEditDiagnosisInput("");
  };

  const saveEditing = (recordId: string) => {
    if (!editDraft) return;

    setToReview((prev) =>
      prev.map((record) =>
        record.id === recordId
          ? {
              ...record,
              hospitalCode: editDraft.hospitalCode.trim(),
              initials: editDraft.initials.trim().toUpperCase(),
              diagnosis: editDraft.diagnosis,
              entryDate: editDraft.entryDate,
              deadlineDate: editDraft.deadlineDate,
              problemSummary: editDraft.problemSummary.trim(),
              reviewItems: editDraft.reviewItems.trim()
            }
          : record
      )
    );
    cancelEditing();
  };

  const startEditingReviewed = (record: OutpatientRecord) => {
    setEditingReviewedId(record.id);
    setEditReviewedDraft({
      hospitalCode: record.hospitalCode,
      initials: record.initials,
      diagnosis: [...record.diagnosis],
      entryDate: record.entryDate,
      deadlineDate: record.deadlineDate,
      problemSummary: record.problemSummary,
      reviewItems: record.reviewItems
    });
    setEditReviewedDiagnosisInput("");
  };

  const cancelEditingReviewed = () => {
    setEditingReviewedId(null);
    setEditReviewedDraft(null);
    setEditReviewedDiagnosisInput("");
  };

  const saveEditingReviewed = (recordId: string) => {
    if (!editReviewedDraft) return;

    setReviewed((prev) =>
      prev.map((record) =>
        record.id === recordId
          ? {
              ...record,
              hospitalCode: editReviewedDraft.hospitalCode.trim(),
              initials: editReviewedDraft.initials.trim().toUpperCase(),
              diagnosis: editReviewedDraft.diagnosis,
              entryDate: editReviewedDraft.entryDate,
              deadlineDate: editReviewedDraft.deadlineDate,
              problemSummary: editReviewedDraft.problemSummary.trim(),
              reviewItems: editReviewedDraft.reviewItems.trim()
            }
          : record
      )
    );
    cancelEditingReviewed();
  };

  const navigateToPatient = (patientId: string) => {
    setExpandedToReview((prev) => ({ ...prev, [patientId]: true }));
    setTimeout(() => {
      patientCardRefs.current[patientId]?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 50);
  };

  return (
    <main className="rounds-shell">
      <section className="hero-band">
        <div>
          <p className="eyebrow">Outpatient Follow-Up Dashboard</p>
          <h1>Outpatient Records</h1>
          <p className="hero-caption">
            Keep important outpatient learning cases and lab follow-up tasks in one
            focused workspace.
          </p>
        </div>

        <div className="hero-actions">
          <button className="primary-btn" onClick={() => setIsNewPatientOpen(true)}>
            New Patient
          </button>
        </div>
      </section>

      <section className="panel outpatient-calendar-panel">
        <header className="section-title">
          <h2>Review Deadline Calendar</h2>
          <div className="calendar-controls">
            <button
              className="ghost-btn calendar-nav-btn"
              onClick={() =>
                setCalendarMonth(
                  new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1)
                )
              }
            >
              ← Prev
            </button>
            <span className="calendar-month-label">
              {calendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </span>
            <button
              className="ghost-btn calendar-nav-btn"
              onClick={() =>
                setCalendarMonth(
                  new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1)
                )
              }
            >
              Next →
            </button>
          </div>
        </header>

        <div className="calendar-grid">
          <div className="calendar-weekdays">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="calendar-weekday">
                {day}
              </div>
            ))}
          </div>
          <div className="calendar-days">
            {calendarDays.map((day, index) => {
              const dateKey = day.toISOString().slice(0, 10);
              const patients = patientsByDeadlineDate[dateKey] || [];
              const isCurrentMonth = day.getMonth() === calendarMonth.getMonth();
              return (
                <div
                  key={index}
                  className={`calendar-day ${!isCurrentMonth ? "calendar-day-other-month" : ""}`}
                >
                  <div className="calendar-day-number">{day.getDate()}</div>
                  <div className="calendar-day-patients">
                    {patients.map((patient) => (
                      <button
                        key={patient.id}
                        className="calendar-patient-item"
                        onClick={() => navigateToPatient(patient.id)}
                        type="button"
                      >
                        <span className="calendar-patient-initials">{patient.initials}</span>
                        <span className="calendar-patient-code">{patient.hospitalCode}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="panel">
        <header className="section-title">
          <h2>To Review</h2>
          <div className="outpatient-header-actions">
            <div className="sort-controls">
              <span className="sort-label">Sort by:</span>
              <button
                className={`sort-btn${sortMode === "entry" ? " active" : ""}`}
                onClick={() => setSortMode("entry")}
              >
                Entry Date
              </button>
              <button
                className={`sort-btn${sortMode === "deadline" ? " active" : ""}`}
                onClick={() => setSortMode("deadline")}
              >
                Deadline Date
              </button>
            </div>
            <span className="count-pill">To review: {toReview.length}</span>
          </div>
        </header>

        <div className="patient-list">
          {sortedToReview.length === 0 ? (
            <p className="muted-text">No pending outpatient records.</p>
          ) : (
            sortedToReview.map((record) => {
              const isExpanded = Boolean(expandedToReview[record.id]);
              const isEditing = editingId === record.id && editDraft !== null;

              return (
                <article
                  className="patient-card"
                  key={record.id}
                  ref={(el) => { patientCardRefs.current[record.id] = el; }}
                >
                  <div className="patient-header-row outpatient-header-row">
                    <button
                      className="patient-toggle"
                      onClick={() => toggleToReviewCard(record.id)}
                      aria-expanded={isExpanded}
                    >
                      <span className="patient-toggle-summary">
                        <span>
                          {record.hospitalCode} | {record.initials}
                        </span>
                        <span className="toggle-diagnosis-tags">
                          {record.diagnosis.map((tag, index) => (
                            <span key={`${record.id}-a-tag-${index}`} className="diagnosis-tag diagnosis-tag-sm">
                              {tag}
                            </span>
                          ))}
                        </span>
                        <span className="outpatient-deadline">Deadline: {record.deadlineDate}</span>
                      </span>
                      <span className="toggle-mark">{isExpanded ? "-" : "+"}</span>
                    </button>

                    <label className="outpatient-check-wrap" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Mark ${record.initials} as reviewed`}
                        checked={false}
                        onChange={() => handleMarkReviewed(record.id)}
                      />
                    </label>
                  </div>

                  {isExpanded && (
                    <div className="outpatient-detail-wrap">
                      {isEditing ? (
                        <div className="outpatient-edit-grid">
                          <label>
                            Hospital code
                            <input
                              value={editDraft.hospitalCode}
                              onChange={(event) =>
                                setEditDraft((prev) =>
                                  prev ? { ...prev, hospitalCode: event.target.value } : prev
                                )
                              }
                            />
                          </label>

                          <label>
                            Patient initials
                            <input
                              value={editDraft.initials}
                              onChange={(event) =>
                                setEditDraft((prev) =>
                                  prev ? { ...prev, initials: event.target.value } : prev
                                )
                              }
                            />
                          </label>

                          <div className="form-field outpatient-full-span">
                            <span className="form-field-label">Diagnosis Tags</span>
                            <div className="tag-input-wrap">
                              {editDraft.diagnosis.map((tag, index) => (
                                <span key={`${record.id}-edit-tag-${index}`} className="diagnosis-tag">
                                  {tag}
                                  <button
                                    type="button"
                                    className="tag-remove"
                                    onClick={() =>
                                      setEditDraft((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              diagnosis: prev.diagnosis.filter((_, i) => i !== index)
                                            }
                                          : prev
                                      )
                                    }
                                  >
                                    x
                                  </button>
                                </span>
                              ))}
                              <input
                                className="tag-text-input"
                                placeholder="Type a tag and press Enter"
                                value={editDiagnosisInput}
                                onChange={(event) => setEditDiagnosisInput(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === ",") {
                                    event.preventDefault();
                                    const nextTag = editDiagnosisInput.trim().replace(/,$/, "");
                                    if (nextTag) {
                                      setEditDraft((prev) =>
                                        prev && !prev.diagnosis.includes(nextTag)
                                          ? { ...prev, diagnosis: [...prev.diagnosis, nextTag] }
                                          : prev
                                      );
                                    }
                                    setEditDiagnosisInput("");
                                  }
                                }}
                              />
                            </div>
                          </div>

                          <label>
                            Entry date
                            <input
                              type="date"
                              value={editDraft.entryDate}
                              onChange={(event) =>
                                setEditDraft((prev) =>
                                  prev ? { ...prev, entryDate: event.target.value } : prev
                                )
                              }
                            />
                          </label>

                          <label>
                            Deadline date for review
                            <input
                              type="date"
                              value={editDraft.deadlineDate}
                              onChange={(event) =>
                                setEditDraft((prev) =>
                                  prev ? { ...prev, deadlineDate: event.target.value } : prev
                                )
                              }
                            />
                          </label>

                          <label className="outpatient-full-span">
                            Short problem summary
                            <textarea
                              value={editDraft.problemSummary}
                              onChange={(event) =>
                                setEditDraft((prev) =>
                                  prev ? { ...prev, problemSummary: event.target.value } : prev
                                )
                              }
                            />
                          </label>

                          <label className="outpatient-full-span">
                            Things to review
                            <textarea
                              value={editDraft.reviewItems}
                              onChange={(event) =>
                                setEditDraft((prev) =>
                                  prev ? { ...prev, reviewItems: event.target.value } : prev
                                )
                              }
                            />
                          </label>

                          <div className="edit-actions outpatient-full-span">
                            <button className="primary-btn small" onClick={() => saveEditing(record.id)}>
                              Save
                            </button>
                            <button className="secondary-btn small" onClick={cancelEditing}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="detail-row">
                            <div className="detail-row-header">
                              <h3>Case Details</h3>
                              <button className="edit-btn" onClick={() => startEditing(record)}>
                                Edit
                              </button>
                            </div>
                            <p>
                              <strong>Hospital code:</strong> {record.hospitalCode}
                            </p>
                            <p>
                              <strong>Initials:</strong> {record.initials}
                            </p>
                            <p>
                              <strong>Entry date:</strong> {record.entryDate}
                            </p>
                            <p>
                              <strong>Deadline date:</strong> {record.deadlineDate}
                            </p>
                            <div className="diagnosis-tags-wrap">
                              {record.diagnosis.map((tag, index) => (
                                <span key={`${record.id}-expanded-tag-${index}`} className="diagnosis-tag">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="detail-row">
                            <h3>Short Problem Summary</h3>
                            <p>{record.problemSummary}</p>
                          </div>

                          <div className="detail-row">
                            <h3>Things to Review</h3>
                            <p>{record.reviewItems}</p>
                          </div>
                        </>
                      )}
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
          <h2>Reviewed</h2>
          <span className="count-pill muted">Reviewed: {reviewed.length}</span>
        </header>

        {reviewed.length > 0 && (
          <div className="discharge-search-wrap">
            <input
              className="discharge-search-input"
              type="text"
              placeholder="Search by diagnosis tag..."
              value={reviewedSearch}
              onChange={(event) => setReviewedSearch(event.target.value)}
            />
            {reviewedSearch && (
              <button className="ghost-btn" onClick={() => setReviewedSearch("")}>
                Clear
              </button>
            )}
          </div>
        )}

        <div className="discharge-grid">
          {reviewed.length === 0 ? (
            <p className="muted-text">No reviewed records yet.</p>
          ) : filteredReviewed.length === 0 ? (
            <p className="muted-text">No reviewed records match "{reviewedSearch}".</p>
          ) : (
            filteredReviewed.map((record) => {
              const isExpanded = Boolean(expandedReviewed[record.id]);
              const isEditing = editingReviewedId === record.id && editReviewedDraft !== null;
              return (
                <article className="discharged-card" key={`reviewed-${record.id}`}>
                  <div className="discharged-card-header">
                    <button
                      className="discharged-toggle"
                      onClick={() => toggleReviewedCard(record.id)}
                      aria-expanded={isExpanded}
                    >
                      <span>
                        <strong>{record.hospitalCode}</strong> | {record.initials} |{" "}
                        {record.diagnosis.map((tag, index) => (
                          <span key={`${record.id}-b-tag-${index}`} className="diagnosis-tag diagnosis-tag-sm">
                            {tag}
                          </span>
                        ))}
                      </span>
                      <span className="toggle-mark">{isExpanded ? "-" : "+"}</span>
                    </button>

                    <button
                      className="delete-mini-btn"
                      onClick={() => {
                        const shouldDelete = window.confirm(
                          `Delete reviewed record ${record.initials}?`
                        );
                        if (shouldDelete) {
                          handleDeleteReviewed(record.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="discharged-detail">
                      {isEditing ? (
                        <div className="outpatient-edit-grid">
                          <label>
                            Hospital code
                            <input
                              value={editReviewedDraft.hospitalCode}
                              onChange={(event) =>
                                setEditReviewedDraft((prev) =>
                                  prev ? { ...prev, hospitalCode: event.target.value } : prev
                                )
                              }
                            />
                          </label>

                          <label>
                            Patient initials
                            <input
                              value={editReviewedDraft.initials}
                              onChange={(event) =>
                                setEditReviewedDraft((prev) =>
                                  prev ? { ...prev, initials: event.target.value } : prev
                                )
                              }
                            />
                          </label>

                          <div className="form-field outpatient-full-span">
                            <span className="form-field-label">Diagnosis Tags</span>
                            <div className="tag-input-wrap">
                              {editReviewedDraft.diagnosis.map((tag, index) => (
                                <span key={`${record.id}-reviewed-edit-tag-${index}`} className="diagnosis-tag">
                                  {tag}
                                  <button
                                    type="button"
                                    className="tag-remove"
                                    onClick={() =>
                                      setEditReviewedDraft((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              diagnosis: prev.diagnosis.filter((_, i) => i !== index)
                                            }
                                          : prev
                                      )
                                    }
                                  >
                                    x
                                  </button>
                                </span>
                              ))}
                              <input
                                className="tag-text-input"
                                placeholder="Type a tag and press Enter"
                                value={editReviewedDiagnosisInput}
                                onChange={(event) => setEditReviewedDiagnosisInput(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === ",") {
                                    event.preventDefault();
                                    const nextTag = editReviewedDiagnosisInput.trim().replace(/,$/, "");
                                    if (nextTag) {
                                      setEditReviewedDraft((prev) =>
                                        prev && !prev.diagnosis.includes(nextTag)
                                          ? { ...prev, diagnosis: [...prev.diagnosis, nextTag] }
                                          : prev
                                      );
                                    }
                                    setEditReviewedDiagnosisInput("");
                                  }
                                }}
                              />
                            </div>
                          </div>

                          <label>
                            Entry date
                            <input
                              type="date"
                              value={editReviewedDraft.entryDate}
                              onChange={(event) =>
                                setEditReviewedDraft((prev) =>
                                  prev ? { ...prev, entryDate: event.target.value } : prev
                                )
                              }
                            />
                          </label>

                          <label>
                            Deadline date for review
                            <input
                              type="date"
                              value={editReviewedDraft.deadlineDate}
                              onChange={(event) =>
                                setEditReviewedDraft((prev) =>
                                  prev ? { ...prev, deadlineDate: event.target.value } : prev
                                )
                              }
                            />
                          </label>

                          <label className="outpatient-full-span">
                            Short problem summary
                            <textarea
                              value={editReviewedDraft.problemSummary}
                              onChange={(event) =>
                                setEditReviewedDraft((prev) =>
                                  prev ? { ...prev, problemSummary: event.target.value } : prev
                                )
                              }
                            />
                          </label>

                          <label className="outpatient-full-span">
                            Things to review
                            <textarea
                              value={editReviewedDraft.reviewItems}
                              onChange={(event) =>
                                setEditReviewedDraft((prev) =>
                                  prev ? { ...prev, reviewItems: event.target.value } : prev
                                )
                              }
                            />
                          </label>

                          <div className="edit-actions outpatient-full-span">
                            <button className="primary-btn small" onClick={() => saveEditingReviewed(record.id)}>
                              Save
                            </button>
                            <button className="secondary-btn small" onClick={cancelEditingReviewed}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p>
                            <strong>Entry date:</strong> {record.entryDate} | <strong>Deadline:</strong>{" "}
                            {record.deadlineDate}
                          </p>
                          <div className="discharged-section">
                            <div className="detail-row-header">
                              <strong>Short Problem Summary</strong>
                              <button className="edit-btn" onClick={() => startEditingReviewed(record)}>
                                Edit
                              </button>
                            </div>
                            <p className="pre-wrap">{record.problemSummary}</p>
                          </div>
                          <div className="discharged-section">
                            <strong>Things to Review</strong>
                            <p className="pre-wrap">{record.reviewItems}</p>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </section>

      {isNewPatientOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <header>
              <h2>New Patient</h2>
              <button className="ghost-btn" onClick={() => setIsNewPatientOpen(false)}>
                Close
              </button>
            </header>

            <form className="patient-form" onSubmit={handleNewPatientSubmit}>
              <label>
                Hospital code
                <input
                  required
                  value={newForm.hospitalCode}
                  onChange={(event) =>
                    setNewForm((prev) => ({ ...prev, hospitalCode: event.target.value }))
                  }
                />
              </label>

              <label>
                Patient initials
                <input
                  required
                  value={newForm.initials}
                  onChange={(event) =>
                    setNewForm((prev) => ({ ...prev, initials: event.target.value }))
                  }
                />
              </label>

              <div className="form-field">
                <span className="form-field-label">Diagnosis Tags</span>
                <div className="tag-input-wrap">
                  {newForm.diagnosis.map((tag, index) => (
                    <span key={`new-tag-${index}`} className="diagnosis-tag">
                      {tag}
                      <button
                        type="button"
                        className="tag-remove"
                        onClick={() =>
                          setNewForm((prev) => ({
                            ...prev,
                            diagnosis: prev.diagnosis.filter((_, i) => i !== index)
                          }))
                        }
                      >
                        x
                      </button>
                    </span>
                  ))}
                  <input
                    className="tag-text-input"
                    placeholder="Type a tag and press Enter"
                    value={newDiagnosisInput}
                    onChange={(event) => setNewDiagnosisInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        const tag = newDiagnosisInput.trim().replace(/,$/, "");
                        if (tag && !newForm.diagnosis.includes(tag)) {
                          setNewForm((prev) => ({ ...prev, diagnosis: [...prev.diagnosis, tag] }));
                        }
                        setNewDiagnosisInput("");
                      } else if (
                        event.key === "Backspace" &&
                        newDiagnosisInput === "" &&
                        newForm.diagnosis.length > 0
                      ) {
                        setNewForm((prev) => ({ ...prev, diagnosis: prev.diagnosis.slice(0, -1) }));
                      }
                    }}
                  />
                </div>
              </div>

              <label>
                Date of entry
                <input
                  type="date"
                  required
                  value={newForm.entryDate}
                  onChange={(event) =>
                    setNewForm((prev) => ({ ...prev, entryDate: event.target.value }))
                  }
                />
              </label>

              <label>
                Deadline date for review
                <input
                  type="date"
                  required
                  value={newForm.deadlineDate}
                  onChange={(event) =>
                    setNewForm((prev) => ({ ...prev, deadlineDate: event.target.value }))
                  }
                />
              </label>

              <label>
                Short problem summary
                <textarea
                  required
                  value={newForm.problemSummary}
                  onChange={(event) =>
                    setNewForm((prev) => ({ ...prev, problemSummary: event.target.value }))
                  }
                />
              </label>

              <label>
                Things to review
                <textarea
                  required
                  value={newForm.reviewItems}
                  onChange={(event) =>
                    setNewForm((prev) => ({ ...prev, reviewItems: event.target.value }))
                  }
                />
              </label>

              <div className="form-actions">
                <button type="button" className="ghost-btn" onClick={() => setIsNewPatientOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Add Patient
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pendingUndo && (
        <div className="undo-toast" role="status" aria-live="polite">
          <p>{undoMessage}</p>
          <button className="ghost-btn" onClick={undoLastAction}>
            Undo
          </button>
        </div>
      )}
    </main>
  );
}