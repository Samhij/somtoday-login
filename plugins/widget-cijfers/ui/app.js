function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const GRADE_QUERY = [
  "type=Toetskolom",
  "type=DeeltoetsKolom",
  "type=Werkstukcijferkolom",
  "type=Advieskolom",
  "additional=vaknaam",
  "additional=resultaatkolom",
  "additional=naamalternatiefniveau",
  "additional=vakuuid",
  "additional=lichtinguuid",
  "sort=desc-geldendResultaatCijferInvoer",
].join("&");

function extra(grade, key) {
  const value = grade.additionalObjects && grade.additionalObjects[key];
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    return value.naam || value.omschrijving || value.weergaveNaam || null;
  }
  return null;
}

function pickGrades(items) {
  const grades = [];
  for (const grade of items) {
    const result = grade.geldendResultaat || grade.resultaat || grade.geldendResultaatCijferInvoer;
    if (result == null || result === "") continue;
    const subject =
      extra(grade, "vaknaam") || grade.vak?.naam || grade.vak?.afkorting || extra(grade, "resultaatkolom") || "Vak";
    const description =
      grade.omschrijving || extra(grade, "resultaatkolom") || (grade.examen ? "Examen" : "Toets");
    const rawDate = grade.datumInvoer || grade.geldendResultaatCijferInvoer;
    grades.push({
      subject,
      result: String(result),
      date: rawDate ? String(rawDate).slice(0, 10) : "",
      description,
    });
    if (grades.length === 8) break;
  }
  return grades;
}

async function loadDossier(kind, studentId) {
  try {
    const data = await cyfers.fetch(`/rest/v1/${kind}/leerling/${studentId}?${GRADE_QUERY}`, {
      headers: { Range: "items=0-99" },
    });
    return { ok: true, items: data.items || [] };
  } catch {
    return { ok: false, items: [] };
  }
}

async function main() {
  const root = document.getElementById("grades");
  try {
    const context = await cyfers.getContext();
    const student = (context.students || []).find((item) => item.id);
    if (!student || !student.id) {
      root.innerHTML = '<p class="empty">Geen leerling gevonden.</p>';
      return;
    }

    const voortgang = await loadDossier("geldendvoortgangsdossierresultaten", student.id);
    const examen = await loadDossier("geldendexamendossierresultaten", student.id);
    const grades = pickGrades([...voortgang.items, ...examen.items]);

    if (grades.length > 0) {
      root.innerHTML = grades
        .map(
          (grade) =>
            `<article class="row"><div><strong>${escapeHtml(grade.subject)}</strong><span class="muted">${escapeHtml(
              grade.description,
            )}</span></div><div><b>${escapeHtml(grade.result)}</b><span class="muted">${escapeHtml(
              grade.date,
            )}</span></div></article>`,
        )
        .join("");
      return;
    }

    root.innerHTML =
      !voortgang.ok && !examen.ok
        ? '<p class="empty">Cijfers laden mislukt.</p>'
        : '<p class="empty">Nog geen cijfers dit schooljaar.</p>';
  } catch {
    root.innerHTML = '<p class="empty">Cijfers laden mislukt.</p>';
  }
}

main();
