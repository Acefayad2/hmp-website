# Inquiry summary filters

The four Admin inquiry summary cards are now buttons. Selecting one updates the inquiry list heading and highlights the selected card.

- Total inquiries: all inquiries; clears search and service selection.
- New: inquiries with status New (case-insensitive).
- Upcoming: event dates today or later. Date-only inputs use local calendar dates.
- Largest event: the highest positive guest count, including ties.

Search and service filters intersect the selected card. Summary counts remain global, consistent with the service mix. Live data updates preserve the selected card. Buttons support keyboard activation, visible focus and pressed states; result counts are announced through a status region.

Validation: 32 Node tests and frontend build passed. Browser checks with synthetic local data covered each card, headings, selected state, tied largest events, service/search intersections, empty results, Total reset, keyboard activation, live refresh persistence and 390px mobile overflow. Desktop and mobile screenshots were visually reviewed. No production records were changed.

This update adds no database migration. It is on the pending release branch and is not published. Earlier changes on this branch still require their documented migrations and publishing approval.
