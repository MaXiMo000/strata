# Security

## Reporting a problem

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab) rather than in a public
issue. Include what you found, how to reproduce it, and its impact. You'll get a reply within a week.

## Protections

- The API is read-only. Every input is validated (coordinate ranges, year range, result limits) and every SQL statement
  is parameterised.
- No accounts, cookies or personal data are stored. Address lookups go from the browser to the geocoder and are not
  logged by strata.
- Ingesters only read from public sources, identify themselves with a descriptive User-Agent, and rate-limit their
  requests.
- No secrets live in the repository; configuration comes from the environment (`.env.example`).
- Text from external catalogs is escaped before it is rendered.
