# Dynamic Island — Browser Media Bridge

Расширение для Яндекс Браузера (Manifest V3) и интеграция с Windhawk
Dynamic Island for Windows — Fork.

## Где файлы

- extension/ — расширение браузера (загружать ЭТУ папку).
- native/host.py — Native Messaging host на Python 3.12 (без pip).
- native/install.ps1 — регистрация host по ID расширения.
- windhawk/browser_media_bridge.h — чтение метаданных, обложки и команд в моде.
- windhawk/mod.wh.cpp — исправленная полная копия исходника Windhawk.
- windhawk/mod.before-browser-bridge.wh.cpp — резервная копия исходника.
- windhawk/test_native_host.py — автоматический тест протокола.

## Установка

1. Открой в Яндекс Браузере browser://extensions.
2. Включи Режим разработчика и Загрузить распакованное расширение.
3. Укажи папку C:\Projects\DynamicIslandBrowserMedia\extension.
4. В карточке расширения скопируй его ID (32 латинские буквы a-p).
5. Запусти PowerShell под обычным пользователем:

   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Projects\DynamicIslandBrowserMedia\native\install.ps1" -ExtensionId ID_РАСШИРЕНИЯ

   Замени ID_РАСШИРЕНИЯ своим ID.

6. Полностью перезапусти Яндекс Браузер (закрой все процессы).
7. Обнови вкладку YouTube: расширение не подключится к старой вкладке
   до перезагрузки этой вкладки.
8. Закрой и открой редактор Windhawk заново, чтобы он не перезаписал
   внешние изменения из старого открытого буфера.
9. Мод C:\ProgramData\Windhawk\EditorWorkspace\mod.wh.cpp уже обновлён.
   Скомпилируй мод, включи Media и BrowserMediaPriority.

## Проверка

При воспроизведении видео открой значок расширения.
Должно быть написано «Native Messaging подключён» и название трека.
Через секунду проверь файл:

    %LOCALAPPDATA%\DynamicIslandBrowserMedia\state.tsv

В нём будет строка DIBRIDGE1, затем Play/Pause, название, исполнитель,
альбом, сайт, позиция в миллисекундах, длительность в миллисекундах
и SHA256 обложки. Обложки кешируются в этой же папке в файлах
cover-<sha256>.bin.

## Возможности и ограничения

- YouTube: название и артист из Media Session API, длительность HTML5,
  обложка из Media Session API или OG Image.
- Другие сайты: Media Session API при наличии; иначе заголовок страницы
  и длительность доступного HTML5 audio/video.
- Play/Pause и seek — HTMLMediaElement. Next/Prev — Media Session handlers
  сайта или кнопки YouTube.
- DRM и сайты без доступного HTML5 элемента могут не определяться.
- Обложки получаются через HTTPS без cookies. Некоторые URL недоступны.
- Нет TCP-сервера: обмен данными только через Native Messaging и файлы.
- Native Messaging host запускается браузером автоматически.

## Проверка обложек (1.0.1)

После изменения файлов распакованного расширения браузер НЕ обновляет скрипты
в уже открытых вкладках. Открой browser://extensions, нажми «Обновить»
или значок перезагрузки у Dynamic Island — Browser Media, затем обнови
вкладку с YouTube (Ctrl+R). После этого снова воспроизведи видео.

В окне расширения теперь отображается «Обложка получена» или текст
ошибки загрузки, например HTTP 403 или No public artwork URLs.
При успешной передаче девятая строка файла
%LOCALAPPDATA%\DynamicIslandBrowserMedia\state.tsv
содержит 64-символьный идентификатор обложки.

Если обложка уже записана, но Windhawk продолжает показывать иконку,
перекомпилируй мод: заголовок windhawk/browser_media_bridge.h изменён,
чтобы повторять неудачное чтение/декодирование изображения.

## Диагностика

Если в расширении «Нет подключения», повтори установку Native Messaging
с актуальным ID и перезапусти браузер. ID меняется после удаления или
перемещения распакованного расширения.

Автоматический тест host без браузера:

    python "C:\Projects\DynamicIslandBrowserMedia\windhawk\test_native_host.py"

Резервная копия исходника находится в windhawk/mod.before-browser-bridge.wh.cpp.
Вернуть её в ProgramData можно с правами администратора.
