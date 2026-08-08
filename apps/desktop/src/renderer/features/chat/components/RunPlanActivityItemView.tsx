/* Renders the latest projected Run Plan without inferring Run completion. */

import { CheckCircle2, Circle, CircleDot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PlanActivityItem } from '../../session-timeline';

export function RunPlanActivityItemView({ item }: { item: PlanActivityItem }) {
  const { t } = useTranslation('chat');
  return (
    <section aria-label={t('processing.plan.label')} className="space-y-2">
      <div className="font-medium text-[var(--color-text)]">
        {item.explanation || t('processing.plan.label')}
      </div>
      {item.plan.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">{t('processing.plan.empty')}</p>
      ) : (
        <ol className="space-y-1.5">
          {item.plan.map((step, index) => {
            const Icon = step.status === 'completed' ? CheckCircle2 : step.status === 'in_progress' ? CircleDot : Circle;
            return (
              <li key={`${index}:${step.step}`} className="flex items-start gap-2">
                <Icon size={15} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-text-muted)]" />
                <span>
                  <span className="sr-only">{t(`processing.plan.status.${step.status}`)}: </span>
                  {step.step}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
