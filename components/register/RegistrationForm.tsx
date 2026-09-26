'use client';

/**
 * The public registration form. One link, vendor or client, Arabic or
 * English, one section per screen.
 *
 * -- What this file is and is not ----------------------------------
 *
 * Every decision about WHAT to ask, what counts as wrong and what may be
 * written lives in lib/registration.ts, where it is unit-tested against
 * the migration files, against lib/registry.ts and against the vendor
 * editor. This file paints it and sends it. If you find yourself adding a
 * field name or a validation rule here, it belongs there instead - there
 * it is checked against the database rather than against memory.
 *
 * -- Why the first question is what you do -------------------------
 *
 * Siraj: "each vendor has different requirements". The category decides
 * the identifier (licence for influencer and UGC, national ID for the
 * other nine), whether platforms are asked for at all, and which extra
 * questions exist. So it is asked first and regForm() computes the rest
 * of the form from the answer - the number of steps included, which is
 * why the rail only appears once something has been picked.
 *
 * -- Why one section per screen ------------------------------------
 *
 * The vendor form is fifteen to eighteen fields depending on the
 * category. Shown at once it reads as a wall, and a stranger on a public
 * link has no reason to push through one. Short screens can also be
 * checked as you go, so nobody reaches the end and is handed four errors.
 *
 * The cost is that a person can be stopped by something on a screen they
 * cannot see, so the last step calls firstBadSection() and JUMPS BACK to
 * the problem instead of refusing to submit.
 *
 * -- Why the insert has no .select() -------------------------------
 *
 * Migration 144 lets anon INSERT here and revokes SELECT. Asking for the
 * row back would fail on a row that was written perfectly well, and the
 * person would be told their registration did not go through. So the
 * insert is fire-and-check-the-error, and nothing is read back.
 *
 * -- Why the page sets <html dir> ----------------------------------
 *
 * Not just this subtree: the scrollbar, the focus ring and the browser's
 * own date picker all follow the document direction, and a form that is
 * right-to-left inside a left-to-right document gets all three wrong.
 */

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import {
  REG_TABLE, regForm, fieldsInSection, label, hint, choiceLabel, sectionLabel,
  dirFor, otherLang, isLatinValue, sectionProblems, firstBadSection,
  problemText, submission, stepText, t,
  type FieldSpec, type Lang, type Problem, type RegForm, type RegKind,
  type VendorCategory,
} from '@/lib/registration';

type Phase = 'filling' | 'sending' | 'done' | 'failed';

const INPUT_TYPE: Record<string, string> = {
  text: 'text', email: 'email', tel: 'tel', date: 'date',
  iban: 'text', number: 'number', link: 'url',
};

/** What the browser may offer to fill in. Unknown keys get nothing. */
const AUTOCOMPLETE: Record<string, string> = {
  full_name: 'organization',
  company_name: 'organization',
  signatory_name: 'name',
  email: 'email',
  company_email: 'email',
  phone: 'tel',
  street: 'street-address',
  city: 'address-level2',
  postcode: 'postal-code',
  country: 'country-name',
};

export function RegistrationForm() {
  const [supabase] = useState(() => createClient());
  const [lang, setLang] = useState<Lang>('en');
  const [kind, setKind] = useState<RegKind | null>(null);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showProblems, setShowProblems] = useState(false);
  const [phase, setPhase] = useState<Phase>('filling');
  const [failure, setFailure] = useState('');
  const [categories, setCategories] = useState<VendorCategory[] | null>(null);
  // A field no person can see and every naive bot fills in. It is not in
  // the field list, so submission() would drop it anyway; this stops the
  // insert happening at all.
  const [trap, setTrap] = useState('');

  const rtl = lang === 'ar';

  useEffect(() => {
    const el = document.documentElement;
    const hadDir = el.getAttribute('dir');
    const hadLang = el.getAttribute('lang');
    el.setAttribute('dir', dirFor(lang));
    el.setAttribute('lang', lang);
    return () => {
      if (hadDir) el.setAttribute('dir', hadDir); else el.removeAttribute('dir');
      if (hadLang) el.setAttribute('lang', hadLang); else el.removeAttribute('lang');
    };
  }, [lang]);

  // The category list. `vendor_categories read` is `using (true)` and anon
  // keeps its SELECT grant (146) precisely so this works with no session.
  useEffect(() => {
    if (kind !== 'vendor' || categories) return;
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('vendor_categories')
        .select('id, key, label, requires_license')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (!alive) return;
      setCategories(error ? [] : ((data ?? []) as unknown as VendorCategory[]));
    })();
    return () => { alive = false; };
  }, [kind, categories, supabase]);

  const category = useMemo<VendorCategory | null>(() => {
    if (kind !== 'vendor') return null;
    const key = (values.vendor_category ?? '').trim();
    return (categories ?? []).find((c) => c.key === key) ?? null;
  }, [kind, values.vendor_category, categories]);

  const form: RegForm | null = useMemo(
    () => (kind ? regForm(kind, category) : null),
    [kind, category],
  );

  const current = form?.sections[step] ?? null;
  const problems: Record<string, Problem> = useMemo(
    () => (form && current ? sectionProblems(form, current.key, values) : {}),
    [form, current, values],
  );

  const font = rtl ? "'Cairo', 'DM Sans', system-ui, sans-serif" : undefined;

  const choose = (k: RegKind) => {
    // A different form is a different set of answers. Carrying a vendor's
    // IBAN into a client registration would be a silent surprise.
    if (k !== kind) setValues({});
    setKind(k);
    setStep(0);
    setShowProblems(false);
  };

  const next = () => {
    if (Object.keys(problems).length > 0) { setShowProblems(true); return; }
    setShowProblems(false);
    setStep((s) => s + 1);
  };

  const back = () => {
    setShowProblems(false);
    if (step === 0) { setKind(null); setCategories(null); return; }
    setStep((s) => s - 1);
  };

  const send = async () => {
    if (!form) return;
    if (Object.keys(problems).length > 0) { setShowProblems(true); return; }

    // Something on an earlier screen may still be wrong - a field filled
    // in and then emptied, or an autofill that put a name where an email
    // goes. Go to it rather than refuse here.
    const bad = firstBadSection(form, values);
    if (bad) {
      const i = form.sections.findIndex((s) => s.key === bad);
      if (i >= 0) setStep(i);
      setShowProblems(true);
      return;
    }

    if (trap.trim()) { setPhase('done'); return; }

    setPhase('sending');
    setFailure('');
    const row = submission(form, values, new Date().toISOString());
    // No .select(): anon may INSERT and may not SELECT (migration 144).
    const { error } = await supabase.from(REG_TABLE[form.kind]).insert(row);
    if (error) {
      setFailure(error.message || '');
      setPhase('failed');
      return;
    }
    setPhase('done');
  };

  const shell = (body: React.ReactNode) => (
    <div
      dir={dirFor(lang)}
      style={{
        minHeight: '100vh', background: 'var(--aq-bg)', color: 'var(--aq-text)',
        fontFamily: font, display: 'flex', flexDirection: 'column',
      }}
    >
      <header
        style={{
          background: 'var(--aq-bg-elevated)',
          borderBottom: '1px solid var(--aq-border-light)',
          padding: '18px clamp(16px, 5vw, 40px)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            aria-hidden
            style={{
              width: 30, height: 30, borderRadius: 8, background: 'var(--aq-accent)',
              color: 'var(--aq-accent-text)', display: 'grid', placeItems: 'center',
              fontWeight: 700, fontSize: 13, fontFamily: "'DM Sans', sans-serif",
            }}
          >
            AQ
          </div>
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>
            AQ Creativity
          </span>
        </div>
        <button
          type="button"
          onClick={() => setLang(otherLang(lang))}
          style={{
            border: '1px solid var(--aq-border)', background: 'var(--aq-bg-elevated)',
            color: 'var(--aq-text-secondary)', borderRadius: 999, padding: '6px 16px',
            fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {rtl ? t('toEnglish', lang) : t('toArabic', lang)}
        </button>
      </header>

      <main
        style={{
          flex: 1, width: '100%', maxWidth: 680, margin: '0 auto',
          padding: 'clamp(24px, 5vw, 44px) clamp(16px, 5vw, 32px) 64px',
        }}
      >
        {body}
      </main>
    </div>
  );

  /* ---- the thank-you screen ---------------------------------------- */

  if (phase === 'done') {
    return shell(
      <div
        style={{
          background: 'var(--aq-bg-elevated)', border: '1px solid var(--aq-border-light)',
          borderRadius: 'var(--aq-radius-lg)', padding: 'clamp(28px, 6vw, 44px)',
          boxShadow: 'var(--aq-shadow)', textAlign: 'center', marginTop: 24,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 46, height: 46, borderRadius: '50%', background: 'var(--aq-accent-light)',
            color: 'var(--aq-accent)', display: 'grid', placeItems: 'center',
            fontSize: 22, margin: '0 auto 18px',
          }}
        >
          &#10003;
        </div>
        <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 8 }}>
          {t('doneTitle', lang)}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--aq-text-muted)', lineHeight: 1.6 }}>
          {t('doneBody', lang)}
        </p>
      </div>,
    );
  }

  /* ---- vendor or client -------------------------------------------- */

  if (!form || !current) {
    return shell(
      <div style={{ marginTop: 'clamp(12px, 4vw, 36px)' }}>
        <h1 style={{ fontSize: 'clamp(23px, 4vw, 27px)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 10 }}>
          {t('pageTitle', lang)}
        </h1>
        <p style={{ fontSize: 15, color: 'var(--aq-text-secondary)', marginBottom: 26 }}>
          {t('chooseTitle', lang)}
        </p>
        <div style={{ display: 'grid', gap: 13 }}>
          {(['vendor', 'client'] as RegKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => choose(k)}
              style={{
                textAlign: rtl ? 'right' : 'left', cursor: 'pointer', fontFamily: 'inherit',
                background: 'var(--aq-bg-elevated)', color: 'var(--aq-text)',
                border: '1.5px solid var(--aq-border)', borderRadius: 'var(--aq-radius-lg)',
                padding: '19px 22px', boxShadow: 'var(--aq-shadow)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
              }}
            >
              <span>
                <span style={{ display: 'block', fontSize: 16.5, fontWeight: 600, marginBottom: 4 }}>
                  {t(k, lang)}
                </span>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--aq-text-muted)' }}>
                  {t(`${k}Hint`, lang)}
                </span>
              </span>
              <span aria-hidden style={{ color: 'var(--aq-text-muted)', fontSize: 18 }}>
                {rtl ? '‹' : '›'}
              </span>
            </button>
          ))}
        </div>
      </div>,
    );
  }

  /* ---- one section at a time --------------------------------------- */

  const last = step === form.sections.length - 1;
  // Until the category is picked there is no honest number of steps to
  // show, and a rail that reads "1 of 1" and then grows is worse than no
  // rail at all.
  const showRail = form.kind === 'client' || form.category !== null;

  return shell(
    <>
      {showRail && (
        <>
          <StepRail sections={form.sections} active={step} lang={lang} />
          <p
            style={{
              fontSize: 12.5, color: 'var(--aq-text-muted)', textAlign: 'center',
              margin: '0 0 18px',
            }}
          >
            {stepText(lang, step + 1, form.sections.length)}
          </p>
        </>
      )}

      <form
        noValidate
        onSubmit={(e) => { e.preventDefault(); if (last) void send(); else next(); }}
        style={{
          background: 'var(--aq-bg-elevated)', border: '1px solid var(--aq-border-light)',
          borderRadius: 'var(--aq-radius-lg)', padding: 'clamp(20px, 4vw, 28px)',
          boxShadow: 'var(--aq-shadow)',
        }}
      >
        <h1 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 5 }}>
          {sectionLabel(current, lang)}
        </h1>
        <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginBottom: 22 }}>
          {t('requiredNote', lang)}
        </p>

        {fieldsInSection(form, current.key).map((f) => (
          f.type === 'category' ? (
            <CategoryPicker
              key={f.key}
              lang={lang}
              categories={categories}
              value={values[f.key] ?? ''}
              problem={showProblems ? problems[f.key] : undefined}
              onChange={(v) => setValues((old) => ({ ...old, [f.key]: v }))}
            />
          ) : (
            <Field
              key={f.key}
              field={f}
              lang={lang}
              value={values[f.key] ?? ''}
              problem={showProblems ? problems[f.key] : undefined}
              onChange={(v) => setValues((old) => ({ ...old, [f.key]: v }))}
            />
          )
        ))}

        {/* Not for people. Off-screen rather than display:none, which some
            bots skip and some screen readers read anyway. */}
        <div aria-hidden style={{ position: 'absolute', left: '-9999px', top: 0 }}>
          <label htmlFor="aq-reg-website">Website</label>
          <input
            id="aq-reg-website" name="website" type="text" tabIndex={-1}
            autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)}
          />
        </div>

        {showProblems && Object.keys(problems).length > 0 && (
          <p role="alert" style={{ color: 'var(--aq-red)', fontSize: 13, marginTop: 6 }}>
            {t('fixFirst', lang)}
          </p>
        )}

        {phase === 'failed' && (
          <p
            role="alert"
            style={{
              color: 'var(--aq-red)', fontSize: 13, marginTop: 14, lineHeight: 1.5,
              background: 'var(--aq-red-bg-soft)', border: '1px solid var(--aq-red-border)',
              borderRadius: 'var(--aq-radius-sm)', padding: '10px 12px',
            }}
          >
            {t('failed', lang)}
            {failure ? <span style={{ display: 'block', opacity: 0.8, marginTop: 4 }}>{failure}</span> : null}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 24 }}>
          <button
            type="button"
            onClick={back}
            disabled={phase === 'sending'}
            style={{
              height: 42, padding: '0 22px', borderRadius: 'var(--aq-radius)',
              border: '1px solid var(--aq-border)', background: 'transparent',
              color: 'var(--aq-text-secondary)', fontFamily: 'inherit', fontWeight: 600,
              fontSize: 14, cursor: 'pointer',
            }}
          >
            {t('back', lang)}
          </button>
          <button
            type="submit"
            disabled={phase === 'sending'}
            style={{
              height: 42, padding: '0 26px', borderRadius: 'var(--aq-radius)', border: 0,
              background: 'var(--aq-accent)', color: 'var(--aq-accent-text)',
              fontFamily: 'inherit', fontWeight: 600, fontSize: 14,
              cursor: phase === 'sending' ? 'default' : 'pointer',
              opacity: phase === 'sending' ? 0.7 : 1, boxShadow: 'var(--aq-shadow)',
            }}
          >
            {phase === 'sending' ? t('sending', lang) : last ? t('submit', lang) : t('next', lang)}
          </button>
        </div>
      </form>
    </>,
  );
}

/* ====================================================================== */

function StepRail({
  sections, active, lang,
}: {
  sections: { key: string; en: string; ar: string }[];
  active: number;
  lang: Lang;
}) {
  return (
    <ol
      style={{
        display: 'flex', alignItems: 'flex-start', listStyle: 'none',
        margin: '0 0 14px', padding: 0, gap: 0,
      }}
    >
      {sections.map((s, i) => {
        const done = i < active;
        const now = i === active;
        return (
          <li
            key={s.key}
            aria-current={now ? 'step' : undefined}
            style={{ display: 'flex', alignItems: 'center', flex: i === sections.length - 1 ? '0 0 auto' : 1 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 70, flex: 'none' }}>
              <span
                style={{
                  width: 27, height: 27, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                  background: done || now ? 'var(--aq-accent)' : 'var(--aq-bg-elevated)',
                  color: done || now ? 'var(--aq-accent-text)' : 'var(--aq-text-muted)',
                  border: `1px solid ${done || now ? 'var(--aq-accent)' : 'var(--aq-border)'}`,
                  boxShadow: now ? '0 0 0 3px var(--aq-accent-light)' : 'none',
                }}
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                style={{
                  fontSize: 10.5, lineHeight: 1.25, textAlign: 'center',
                  color: now ? 'var(--aq-text)' : 'var(--aq-text-muted)',
                  fontWeight: now ? 600 : 400,
                }}
              >
                {sectionLabel(s, lang)}
              </span>
            </div>
            {i === sections.length - 1 ? null : (
              <span
                aria-hidden
                style={{
                  height: 1, flex: 1, marginBottom: 22,
                  background: done ? 'var(--aq-accent)' : 'var(--aq-border)',
                }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The question everything else follows from, so it is a row of things to
 * press rather than a dropdown to miss.
 */
function CategoryPicker({
  lang, categories, value, problem, onChange,
}: {
  lang: Lang;
  categories: VendorCategory[] | null;
  value: string;
  problem?: Problem;
  onChange: (v: string) => void;
}) {
  if (categories === null) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 9 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            style={{
              height: 44, borderRadius: 'var(--aq-radius)', background: 'var(--aq-bg-sunken)',
              border: '1px solid var(--aq-border-light)',
            }}
          />
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <p role="alert" style={{ color: 'var(--aq-red)', fontSize: 13 }}>
        {t('categoryEmpty', lang)}
      </p>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--aq-text-secondary)', marginBottom: 13 }}>
        {t('categoryPrompt', lang)}
      </p>
      <div
        role="radiogroup"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 9 }}
      >
        {categories.map((c) => {
          const on = c.key === value;
          return (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(c.key)}
              style={{
                minHeight: 44, padding: '10px 14px', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13.5, fontWeight: on ? 600 : 500,
                textAlign: 'start',
                color: on ? 'var(--aq-text)' : 'var(--aq-text-secondary)',
                background: on ? 'var(--aq-accent-light)' : 'var(--aq-bg-elevated)',
                border: `1.5px solid ${on ? 'var(--aq-accent)' : 'var(--aq-border)'}`,
                borderRadius: 'var(--aq-radius)',
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      {problem ? (
        <p style={{ color: 'var(--aq-red)', fontSize: 12, marginTop: 9 }}>
          {problemText(problem, lang)}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  field, lang, value, problem, onChange,
}: {
  field: FieldSpec;
  lang: Lang;
  value: string;
  problem?: Problem;
  onChange: (v: string) => void;
}) {
  const id = `aq-reg-${field.key}`;
  const errId = `${id}-err`;
  const latin = isLatinValue(field.key);
  const rtl = lang === 'ar';

  const box: React.CSSProperties = {
    width: '100%', height: 40, padding: '0 11px', fontSize: 14, fontFamily: 'inherit',
    color: 'var(--aq-text)', borderRadius: 'var(--aq-radius-sm)',
    background: problem ? 'var(--aq-red-bg-soft)' : 'var(--aq-bg-elevated)',
    border: `1px solid ${problem ? 'var(--aq-red-border)' : 'var(--aq-border)'}`,
    textAlign: latin && rtl ? 'right' : undefined,
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <label
        htmlFor={id}
        style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--aq-text-secondary)', marginBottom: 5 }}
      >
        {label(field, lang)}
        {field.required ? <span style={{ color: 'var(--aq-accent)', fontWeight: 700 }}> *</span> : null}
      </label>

      {field.type === 'choice' ? (
        <select
          id={id}
          name={field.key}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errId : undefined}
          style={box}
        >
          <option value="">&mdash;</option>
          {(field.choices ?? []).map((c) => (
            <option key={c.value} value={c.value}>{choiceLabel(c, lang)}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={field.key}
          type={INPUT_TYPE[field.type] ?? 'text'}
          inputMode={field.type === 'number' ? 'numeric' : undefined}
          min={field.type === 'number' ? 1 : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={hint(field, lang) || undefined}
          autoComplete={AUTOCOMPLETE[field.key] ?? 'off'}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errId : undefined}
          // Numbers, addresses, links and dates read left to right whatever
          // the page does. Without this the Arabic form shows
          // +966 50 123 4567 as 4567 123 50 966+.
          dir={latin ? 'ltr' : undefined}
          style={box}
        />
      )}

      {problem ? (
        <p id={errId} style={{ color: 'var(--aq-red)', fontSize: 11.5, marginTop: 4, lineHeight: 1.4 }}>
          {problemText(problem, lang)}
        </p>
      ) : null}
    </div>
  );
}
