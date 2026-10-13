# Dynamic Island — Browser Media Plugin

Расширение Chromium/Яндекс.Браузера и Native Messaging host для получения из браузера метаданных воспроизводимого трека, обложки, таймлайна и управления воспроизведением.

**Основной проект:** https://github.com/QueenDekim/Dynamic-Island-for-Windows-Enhanced
**Этот репозиторий (Git submodule):** https://github.com/QueenDekim/Dynamic-Island-Browser-Media-Plugin

## Структура

- extension/ — Manifest V3 расширение (подключать именно эту папку).
- native/host.py — Native Messaging host на Python 3.
- native/launcher.cpp — вспомогательный EXE-запускатель на Windows.
- native/build-launcher.ps1 — сборка launcher.exe компилятором Windhawk.
- native/install.ps1 — регистрация host в реестре текущего пользователя.
- windhawk/browser_media_bridge.h — C++ мост, встраиваемый в основной Windhawk-мод.
- tests/ и extension/test_*.cjs — проверки YouTube artwork и транспорта.

Исторические локальные копии и резервные копии Windhawk остаются на машине разработчика, но не включаются в Git.

## Установка расширения

1. В Яндекс.Браузере откройте browser://extensions.
2. Включите режим разработчика, выберите «Загрузить распакованное расширение» и укажите папку extension/.
3. Скопируйте ID установленного расширения (32 символа от a до p).
4. Запустите Windows PowerShell:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\native\install.ps1 -ExtensionId YOUR_EXTENSION_ID
~~~

Скрипт автоматически соберёт native/launcher.exe, если его ещё нет; для сборки нужен Windhawk Compiler либо Windows Clang/MinGW C++ toolchain. Требуется Python, доступный как python.exe. Администратор Windows для регистрации HKCU не требуется.

5. Полностью закройте и заново откройте браузер, перезагрузите вкладки с медиаплеером и проверьте статус Native Messaging.

## Windhawk

**Полный C++ исходник собирается в основном репозитории**:

~~~powershell
git clone --recurse-submodules https://github.com/QueenDekim/Dynamic-Island-for-Windows-Enhanced.git
cd Dynamic-Island-for-Windows-Enhanced
python scripts/build.py
~~~

Содержимое dist/mod.wh.cpp вставьте в редактор Windhawk, затем скомпилируйте. Самостоятельно заменять header include-пути больше не требуется.

## Проверки

~~~powershell
node tests/test_artwork.js
node extension/test_background_art.cjs
node extension/test_page_art.cjs
python windhawk/test_native_host.py
~~~

Последний тест использует launcher.exe при его наличии; иначе запускает host.py напрямую через Python, чтобы проверять чистый Git checkout без локальных бинарников.

## Безопасность

Native Messaging host работает только локально; расширение получает данные воспроизведения через Media Session и браузерные API. Путь к Python, исполняемый launcher.exe и локальный manifest конфигурации привязаны к компьютеру и исключены из Git.
