# Расчёты к `docs/19_ANALYSIS.md`

Каждое число документа получено этими скриптами. Ядро вызывается как библиотека
(`from orbita_core import ...`), сценарии в `scenarios/` и код в `core/` не меняются:
варианты конфигурации собираются в памяти из словаря сценария.

Повторить всё одной командой (около пяти минут на одном ядре):

```
python -m venv .venv
.venv/Scripts/python -m pip install -e "core[dev]"
.venv/Scripts/python docs/analysis/run_all.py
```

Результаты перезаписываются в `docs/analysis/results/*.json`. Отдельный расчёт
запускается своим скриптом, например `python docs/analysis/isl_range.py`;
исключение — `recommendation.py`, который читает лучшую точку из `results/sweep.json`
и потому идёт после `sweep_config.py`.

| Скрипт | Результат | Что считает |
|---|---|---|
| `baseline.py` | `baseline.json` | четыре сценария кейса, метрики и причины перерывов |
| `deployment.py` | `deployment.json` | этапы развёртывания 1 / 2 / 3 |
| `isl_range.py` | `isl_range.json` | дальность ISL от 1500 до 4000 км |
| `resilience_analysis.py` | `resilience.json` | сценарий 03 против 01 и отказ каждого из 48 аппаратов |
| `failure_depth.py` | `failure_depth.json` | одновременные отказы: жадный худший случай и случайные наборы |
| `sweep_config.py` | `sweep.json` | перебор RAAN и фазы плоскостей |
| `recommendation.py` | `recommendation.json` | проверка найденной конфигурации в трёх условиях |
| `policies.py` | `policies.json` | три политики маршрутизации |
| `improvements.py` | `improvements.json` | второй шлюз, возвышение, наклонение, размер группировки |
