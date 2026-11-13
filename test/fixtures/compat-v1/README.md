# Synthetic Moodle compatibility fixtures v1

These examples are hand-authored HTML or generated PDF bytes from the offline test suite. They use fictitious IDs, generic course text and canonical URL shapes. Tests parse local bytes or use mocked requests.

| Fixture | Expected outcome |
| --- | --- |
| course.html | Inline course sections parse with searchable Macedonian content and canonical resource links. |
| separate-section.html | An owned separate section contributes searchable activity text. A denied or wrong-course response in the traversal tests yields partial coverage. |
| folder.html | The owned folder yields one PDF path. A different course is rejected. |
| text-pdf.mjs | Generates reproducible text PDFs for page provenance and blank/unsupported cases. |
| choice.html | An explicit saved choice is selected. A changed label or deleted choice markup yields unknown. |
| assignment.html | MK, EN and SQ dates parse as local times with unknown offset. |
| assignment-malformed.html | An impossible date remains unresolved. |
| announcement.html | An offset timestamp normalizes to UTC. Instruction-shaped text remains untrusted course content. |

Run the corpus and existing adapter tests with npm test. Add synthetic cases beside their adapter tests when supporting new layouts. Keep this directory versioned and document changes to expected results.
