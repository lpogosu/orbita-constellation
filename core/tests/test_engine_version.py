import re
import tomllib
from pathlib import Path

from orbita_core import ENGINE_VERSION

ENGINE_VERSION_PATTERN = re.compile(r"^orbita-core-\d+\.\d+\.\d+$")


def test_engine_version_matches_documented_format() -> None:
    """Формат имени версии зафиксирован в 03_GLOSSARY.md §2 (`orbita-core-1.0.0`)."""
    assert ENGINE_VERSION_PATTERN.match(ENGINE_VERSION) is not None


def test_engine_version_follows_package_version() -> None:
    """Версия в коде и версия дистрибутива расходиться не должны.

    По ним переиспользуется готовый Run (ADR-011): расхождение означало бы, что два
    разных ядра выдают себя за одно и то же.
    """
    pyproject_path = Path(__file__).resolve().parents[1] / "pyproject.toml"
    pyproject = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
    package_version = str(pyproject["project"]["version"])
    assert ENGINE_VERSION.removeprefix("orbita-core-") == package_version
