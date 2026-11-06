import { Fragment, type ReactNode } from "react";

import { CitationText } from "@/components/citation";
import type { PaperSize } from "@/generated/prisma/enums";
import type { DocumentLabels } from "@/lib/document-labels";
import type { TextDirection } from "@/lib/document-language";
import type { ProfileData } from "@/lib/profile";
import { displayLink, type ResumeContent } from "@/lib/resume-content";
import { sectionHeading, type SectionLayout } from "@/lib/resume-sections";
import { skillLine } from "@/lib/skill-groups";
import type { ResolvedTheme } from "@/lib/themes";
import { webHref } from "@/lib/web-link";

import { Contact, DocumentPage, DocumentSection, type UnitRenderer } from "./document-page";
import documentStyles from "./document.module.css";
import styles from "./latex-classic-resume.module.css";

/** The sections this layout draws itself, in its order; any other the resume has follows them. */
const OWN_SECTIONS = ["summary", "experience", "projects", "skills", "education", "publications"];

const joined = (items: ReactNode[]) =>
  items.map((item, index) => (
    <Fragment key={index}>
      {index > 0 && " | "}
      {item}
    </Fragment>
  ));

function Link({ to }: { to: string }) {
  const href = webHref(to);
  const text = <Contact>{displayLink(to)}</Contact>;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={styles.link}>
      {text}
    </a>
  ) : (
    text
  );
}

/**
 * The classic one-page LaTeX resume (the "LaTeX Classic" theme): a fixed
 * section order and its own header, role rows and project paragraphs, which
 * theme settings can't make. `ResumeDocument` hands it what it worked out, and
 * the sections this layout doesn't draw as they are in `drawn`.
 */
export function LatexClassicResume({
  theme,
  content,
  labels,
  profile,
  paper,
  sections,
  lang,
  dir,
  renderUnit,
  order,
  drawn,
}: {
  theme: ResolvedTheme;
  content: ResumeContent;
  labels: DocumentLabels;
  profile: ProfileData;
  paper: PaperSize;
  sections: SectionLayout;
  lang: string | undefined;
  dir: TextDirection;
  renderUnit: UnitRenderer;
  /** The sections with something to show, in the resume's order. */
  order: string[];
  drawn: Record<string, ReactNode>;
}) {
  const { basics } = profile;
  const locations = new Map(profile.experience.map((entry) => [entry.id, entry.location.trim()]));
  const place = [basics.city, basics.country]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  const contact = [place, basics.email.trim(), basics.phone.trim()].filter(Boolean);
  const links = [basics.website, basics.linkedin].map((link) => link.trim()).filter(Boolean);
  const title = (key: string, usual: string) => sectionHeading(sections, key, usual);
  const shown = (key: string) => order.includes(key);

  return (
    <DocumentPage theme={theme} paper={paper} lang={lang} dir={dir} className={styles.page} label="Resume">
      <header className={styles.header}>
        <h1 className={styles.name}>{content.name}</h1>
        {contact.length > 0 && <p>{joined(contact.map((item) => <Contact key={item}>{item}</Contact>))}</p>}
        {links.length > 0 && <p>{joined(links.map((link) => <Link key={link} to={link} />))}</p>}
      </header>
      <div className={`${documentStyles.columns} ${styles.body}`}>
        <div className={documentStyles.column}>
          {shown("summary") && (
            <DocumentSection title={title("summary", labels.profile)}>
              {renderUnit({ id: "summary", children: <p className={styles.justified}>{content.summary}</p> })}
            </DocumentSection>
          )}
          {shown("experience") && (
            <DocumentSection title={title("experience", labels.experience)}>
              {content.experience.map((role, index) => {
                const location = locations.get(role.id);
                const company = index === 0 || content.experience[index - 1].company !== role.company;
                return (
                  <Fragment key={role.id}>
                    {renderUnit({
                      id: `experience:${role.id}`,
                      className: documentStyles.entry,
                      head: (
                        <>
                          {company && (role.company || location) && (
                            <div className={documentStyles.entryHead}>
                              <strong>{role.company}</strong>
                              <span className={styles.edge}>{location}</span>
                            </div>
                          )}
                          <div className={documentStyles.entryHead}>
                            <em>{role.role}</em>
                            <span className={styles.edge}>{role.dates}</span>
                          </div>
                        </>
                      ),
                      children: role.bullets.length > 0 && (
                        <ul className={documentStyles.bullets}>
                          {role.bullets.map((bullet, position) => (
                            <li key={position}>{bullet}</li>
                          ))}
                        </ul>
                      ),
                    })}
                  </Fragment>
                );
              })}
            </DocumentSection>
          )}
          {shown("projects") && (
            <DocumentSection title={title("projects", labels.projects)}>
              {content.projects.map((project) => {
                const second = project.link ? <Link to={project.link} /> : project.skills.join(", ");
                return (
                  <Fragment key={project.id}>
                    {renderUnit({
                      id: `project:${project.id}`,
                      className: documentStyles.entry,
                      head: (
                        <p className={styles.projectHead}>
                          <strong>{project.name}</strong>
                          {second && <> | {second}</>}
                        </p>
                      ),
                      children: project.bullets.length > 0 && <p className={styles.justified}>{project.bullets.map((bullet) => (/[.!?。]$/.test(bullet) ? bullet : `${bullet}.`)).join(" ")}</p>,
                    })}
                  </Fragment>
                );
              })}
            </DocumentSection>
          )}
          {shown("skills") && (
            <DocumentSection title={title("skills", labels.skills)}>
              {renderUnit({
                id: "skills",
                children: content.skills
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line, index) => {
                    const { label, text } = skillLine(line);
                    return (
                      <p key={index}>
                        {label && <strong>{label}: </strong>}
                        {text.replaceAll(" · ", ", ")}
                      </p>
                    );
                  }),
              })}
            </DocumentSection>
          )}
          {shown("education") && (
            <DocumentSection title={title("education", labels.education)}>
              {content.education.map((entry) => (
                <Fragment key={entry.id}>
                  {renderUnit({
                    id: `education:${entry.id}`,
                    className: documentStyles.entry,
                    head: (
                      <div className={documentStyles.entryHead}>
                        <p>
                          <strong>{entry.degree}</strong>
                          {entry.school && `${entry.degree ? ", " : ""}${entry.school}`}
                        </p>
                        <span className={styles.edge}>{entry.dates}</span>
                      </div>
                    ),
                    children: null,
                  })}
                </Fragment>
              ))}
            </DocumentSection>
          )}
          {shown("publications") && (
            <DocumentSection title={title("publications", labels.publications)}>
              {content.publications.map((entry) => (
                <Fragment key={entry.id}>
                  {renderUnit({
                    id: `publication:${entry.id}`,
                    className: styles.bullet,
                    children: (
                      <p>
                        <CitationText text={entry.citation} />
                        {entry.link && (
                          <>
                            {" "}
                            <Link to={entry.link} />
                          </>
                        )}
                      </p>
                    ),
                  })}
                </Fragment>
              ))}
            </DocumentSection>
          )}
          {order.filter((key) => !OWN_SECTIONS.includes(key)).map((key) => drawn[key])}
        </div>
      </div>
    </DocumentPage>
  );
}
