/* ---- optional: Start Menu shortcuts ---- */
Section /o '$(EV_SEC_MENU)' SecMenu
  CreateDirectory '$SMPROGRAMS\EasyVideo'
  CreateShortCut '$SMPROGRAMS\EasyVideo\EasyVideo.lnk' '$INSTDIR\app\EasyVideo.exe' '' '$INSTDIR\app\EasyVideo.exe' 0
  CreateShortCut '$SMPROGRAMS\EasyVideo\EasyVideo 数据目录.lnk' '$INSTDIR\data'
  CreateShortCut '$SMPROGRAMS\EasyVideo\EasyVideo 日志目录.lnk' '$INSTDIR\log'
SectionEnd

/* ---- optional: desktop shortcut ---- */
Section /o '$(EV_SEC_DESKTOP)' SecDesktop
  CreateShortCut '$DESKTOP\EasyVideo.lnk' '$INSTDIR\app\EasyVideo.exe' '' '$INSTDIR\app\EasyVideo.exe' 0
SectionEnd

/* ---- optional: put ev on PATH ---- */
; ev.cmd 已随 payload 安装到 bin/，这里只把它追加到用户 PATH。
Section /o '$(EV_SEC_PATH)' SecPath
  ReadRegStr $1 HKCU 'Environment' 'Path'
  StrCpy $2 '$INSTDIR\bin'
  ${If} $1 == ''
    WriteRegExpandStr HKCU 'Environment' 'Path' '$2'
  ${Else}
    ${StrLoc} $3 '$1' '$2' '>'
    ${If} $3 == ''
      WriteRegExpandStr HKCU 'Environment' 'Path' '$1;$2'
    ${EndIf}
  ${EndIf}
SectionEnd

/* ---- optional: launch when done ---- */
Section /o '$(EV_SEC_RUN)' SecRun
  ExecShell 'open' '$INSTDIR\app\EasyVideo.exe' '--open-delayed'
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} '$(EV_SEC_MAIN)'
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMenu} '$(EV_SEC_MENU)'
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} '$(EV_SEC_DESKTOP)'
  !insertmacro MUI_DESCRIPTION_TEXT ${SecPath} '$(EV_SEC_PATH)'
  !insertmacro MUI_DESCRIPTION_TEXT ${SecRun} '$(EV_SEC_RUN)'
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section 'Uninstall' SecUninstall
  Delete '$DESKTOP\EasyVideo.lnk'
  Delete '$SMPROGRAMS\EasyVideo\*.lnk'
  RMDir '$SMPROGRAMS\EasyVideo'
  ; 从用户 PATH 里摘掉 bin 目录。
  ReadRegStr $1 HKCU 'Environment' 'Path'
  ${UnStrRep} $1 '$1' '$INSTDIR\bin;' ''
  ${UnStrRep} $1 '$1' ';$INSTDIR\bin' ''
  WriteRegExpandStr HKCU 'Environment' 'Path' '$1'
  RMDir /r '$INSTDIR\app'
  RMDir /r '$INSTDIR\bin'
  RMDir /r '$INSTDIR\program'
  ; data/ 与 log/ 保留：用户的媒体与日志在里面。
  Delete '$INSTDIR\Uninstall.exe'
  DeleteRegKey HKCU '${EV_FILES_KEY}'
  DeleteRegKey HKCU 'Software\Classes\ev'
  DeleteRegKey HKCU '${EV_UNKEY}'
  DeleteRegKey HKCU '${EV_APPKEY}'
  RMDir '$INSTDIR'
SectionEnd

Function un.onInit
  !insertmacro MUI_UNGETLANGUAGE
FunctionEnd

