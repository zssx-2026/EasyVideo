/* ---- main section: unpack to cache, install from cache, write hashes ---- */
Section '$(EV_SEC_MAIN)' SecMain
  SectionIn RO
  ${If} $EvMode == 'remove'
    IfFileExists '$INSTDIR\Uninstall.exe' 0 +3
      ExecWait '"$INSTDIR\Uninstall.exe" _?=$INSTDIR'
      Quit
    Abort
  ${EndIf}

  DetailPrint '$(EV_CACHE)'
  CreateDirectory '${EV_CACHE}'
  RMDir /r '${EV_PAYLOAD}'
  CreateDirectory '${EV_PAYLOAD}'
  SetOutPath '${EV_PAYLOAD}'
  File /r 'payload\*'

  DetailPrint '$(EV_COPY)'
  CreateDirectory '$INSTDIR'
  CreateDirectory '$INSTDIR\data'
  CreateDirectory '$INSTDIR\log'
  nsExec::ExecToLog '"$SYSDIR\xcopy.exe" /E /I /Y /Q "${EV_PAYLOAD}" "$INSTDIR"'
  Pop $0

  DetailPrint '$(EV_HASH)'
  DeleteRegKey HKCU '${EV_FILES_KEY}'
  !insertmacro EV_WRITE_HASHES
  WriteRegStr HKCU '${EV_APPKEY}' 'InstallDir' '$INSTDIR'
  WriteRegStr HKCU '${EV_APPKEY}' 'InstallMode' '$EvMode'
  WriteRegStr HKCU '${EV_APPKEY}' 'Version' '${EV_VERSION}'
  WriteRegStr HKCU '${EV_APPKEY}' 'FileCount' '${EV_FILECOUNT}'
  WriteRegStr HKCU '${EV_APPKEY}' 'CacheDir' '${EV_PAYLOAD}'

  ; ev:// protocol for the current user.
  WriteRegStr HKCU 'Software\Classes\ev' '' 'URL:EasyVideo Protocol'
  WriteRegStr HKCU 'Software\Classes\ev' 'URL Protocol' ''
  WriteRegStr HKCU 'Software\Classes\ev\DefaultIcon' '' '$INSTDIR\app\EasyVideo.exe,0'
  WriteRegStr HKCU 'Software\Classes\ev\shell\open\command' '' '$INSTDIR\app\EasyVideo.exe %1'

  WriteRegStr HKCU '${EV_UNKEY}' 'DisplayName' 'EasyVideo ${EV_LABEL}'
  WriteRegStr HKCU '${EV_UNKEY}' 'DisplayIcon' '$INSTDIR\app\EasyVideo.exe'
  WriteRegStr HKCU '${EV_UNKEY}' 'DisplayVersion' '${EV_LABEL}'
  WriteRegStr HKCU '${EV_UNKEY}' 'Publisher' 'EasyVideo'
  WriteRegStr HKCU '${EV_UNKEY}' 'UninstallString' '$INSTDIR\Uninstall.exe'
  WriteRegStr HKCU '${EV_UNKEY}' 'QuietUninstallString' '$INSTDIR\Uninstall.exe /S'
  WriteRegDWORD HKCU '${EV_UNKEY}' 'NoModify' 1
  WriteRegDWORD HKCU '${EV_UNKEY}' 'NoRepair' 0

  WriteUninstaller '$INSTDIR\Uninstall.exe'
SectionEnd

