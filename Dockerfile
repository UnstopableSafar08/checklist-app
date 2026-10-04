# Checklist web app (static files only).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8080

WORKDIR /srv/checklist

COPY index.html ./
COPY server.py ./
COPY assets/ ./assets/

EXPOSE 8080

CMD ["python", "server.py"]
