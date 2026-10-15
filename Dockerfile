# strata: the API and the built web app in one image.
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml ./
COPY strata/ strata/
# Editable, so the package stays at /app and finds web/dist and data/ beside it.
RUN pip install --no-cache-dir -e .
COPY --from=web /web/dist web/dist
RUN useradd --system --no-create-home strata && mkdir -p data && chown strata data
USER strata
EXPOSE 8000
CMD ["uvicorn", "strata.api:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
