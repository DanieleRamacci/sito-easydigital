FROM python:3.12-slim

WORKDIR /app

# Install deps first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

ENV FLASK_APP=app.py
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

EXPOSE 5051

# On startup:
# 1. fix-schema  → drop old unique index, ensure new tables exist (safe on fresh DB too)
# 2. init-db     → create_all (idempotent)
# 3. gunicorn    → serve with 2 workers
CMD ["sh", "-c", "flask fix-schema && flask init-db && gunicorn --bind 0.0.0.0:5051 --workers 2 --timeout 60 wsgi:app"]
