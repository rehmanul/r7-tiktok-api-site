#!/bin/bash

# Install system dependencies
yum install -y amazon-linux-extras
amazon-linux-extras install epel -y

# Install Chromium and its dependencies
yum install -y \
    chromium \
    chromium-headless \
    chromium-libs \
    nss \
    cups-libs \
    atk \
    at-spi2-atk \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXi \
    libXrandr \
    libXScrnSaver \
    libXtst \
    pango \
    alsa-lib

# Create symlinks if needed
ln -s /usr/bin/chromium-browser /tmp/chromium || true

# Report versions
echo "Node version: $(node --version)"
echo "Chromium version: $(chromium-browser --version)"

echo "Build complete"