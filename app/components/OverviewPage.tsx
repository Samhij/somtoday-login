"use client";

import { LayoutGrid } from "lucide-react";
import { PluginFrame } from "@/app/components/PluginFrame";
import { resolvePluginIcon } from "@/lib/plugins/icons";
import type { PluginSessionContext } from "@/lib/somtoday";

type WidgetPlugin = {
  id: string;
  nav: { label: string; icon: string; order: number };
};

type Props = {
  context: PluginSessionContext;
  widgets: WidgetPlugin[];
};

export function OverviewPage({ context, widgets }: Props) {
  return (
    <div className="overview">
      <header className="overview-head">
        <h1>Overzicht</h1>
        <p className="lede">
          {context.schoolYear
            ? `${context.schoolName} · Schooljaar ${context.schoolYear}`
            : context.schoolName}
        </p>
      </header>

      <section className="overview-students">
        {context.students.length === 0 ? (
          <p className="empty">Geen leerlingen gevonden.</p>
        ) : (
          context.students.map((student) => (
            <article className="student" key={student.id || student.name}>
              <strong>{student.name}</strong>
              <p className="meta">
                {student.studentNumber ? `Nr. ${student.studentNumber}` : "Geen leerlingnummer"}
                {student.email ? ` · ${student.email}` : ""}
              </p>
            </article>
          ))
        )}
      </section>

      <section className="widget-grid">
        {widgets.length === 0 ? (
          <p className="empty">Geen widgets actief. Schakel er een in onder Plugins.</p>
        ) : (
          <div className="widget-cards">
            {widgets.map((widget) => {
              const Icon = resolvePluginIcon(widget.nav.icon);
              return (
                <article key={widget.id} className="widget-card">
                  <header className="widget-card-head">
                    <Icon size={16} strokeWidth={2} aria-hidden />
                    <strong>{widget.nav.label}</strong>
                  </header>
                  <div className="widget-card-body">
                    <PluginFrame pluginId={widget.id} context={context} variant="widget" />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
