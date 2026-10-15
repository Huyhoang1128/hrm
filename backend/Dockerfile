# Use official Python runtime as a parent image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set work directory
WORKDIR /app

# Install system dependencies
# - libreoffice: convert .docx → .pdf
# - fonts-liberation: open-source clone (Liberation Serif ~ Times New Roman)
# - ttf-mscorefonts-installer: Times New Roman / Arial / Verdana CHÍNH GỐC của Microsoft
#   (cần enable repo `contrib` + accept EULA tự động qua debconf)
# - fonts-crosextra-carlito / caladea: Calibri / Cambria replacement metric-compatible
# - fonts-dejavu + fonts-noto-cjk: Unicode + tiếng Việt fallback an toàn
RUN echo "deb http://deb.debian.org/debian bookworm contrib non-free" \
        > /etc/apt/sources.list.d/contrib-nonfree.list \
    && echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" \
        | debconf-set-selections \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        postgresql-client \
        build-essential \
        libpq-dev \
        libreoffice \
        default-jre-headless \
        fonts-liberation \
        fonts-crosextra-carlito \
        fonts-crosextra-caladea \
        fonts-dejavu \
        fonts-noto-core \
        ttf-mscorefonts-installer \
        fontconfig \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy project
COPY . .

# Collect static files
RUN python manage.py collectstatic --noinput


# Make port 8000 available to the world outside this container
EXPOSE 8000

# Run the application with gunicorn config
CMD ["gunicorn", "--config", "gunicorn_config.py", "config.wsgi:application"]
