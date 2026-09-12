"""Запуск ядра как программы: `python -m orbita_core`."""

from __future__ import annotations

import sys

from orbita_core.cli import main

if __name__ == "__main__":
    sys.exit(main())
