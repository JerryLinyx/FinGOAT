# Appendix

This directory stores stable reference material for the current system and active development cycle.

## Suggested use

- Keep module maps, service boundaries, schemas, and templates here.
- Update these files when the current understanding changes materially.
- Snapshot this directory into `../archive/vX.Y.Z/appendix/` when a version is closed.
- Core appendix files should carry `last_verified` and `verified_against` frontmatter.

## Contents

- `module-map.md`: module responsibilities and weak points
- `repo-file-index.md`: repository-wide file and module responsibility index
- `interfaces.md`: key external and internal interfaces
- `system-architecture.md`: layered architecture and collaboration flow
- `data-models.md`: core data, formats, lifecycle, and processing chains
- `service-boundaries.md`: role boundary summary
- `agent-role-map.md`: current and branch-derived agent roles
- `team-branches-review.md`: capability review of team branches
- `vendor-routing.md`: current vendor routing abstraction
- `templates/`: reusable ADR and review templates
