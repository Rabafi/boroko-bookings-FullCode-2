!ifdef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var TsaBonnoDeleteDataCheckbox
  Var TsaBonnoDeleteDataChoice

  ; Add a pre-uninstall choice so users can keep or remove local app data.
  !macro customUnInit
    StrCpy $TsaBonnoDeleteDataChoice "0"
  !macroend

  !macro customUnWelcomePage
    !insertmacro MUI_PAGE_INIT
    UninstPage custom un.TsaBonnoDeleteDataPageCreate un.TsaBonnoDeleteDataPageLeave
  !macroend

  Function un.TsaBonnoDeleteDataPageCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "Tsa Bonno LodgingOS will be removed from this computer."
    Pop $0

    ${NSD_CreateLabel} 0 30u 100% 34u "If you want to erase the local sessions, profiles, cache, and backups stored on this PC, check the box below."
    Pop $0

    ${NSD_CreateCheckbox} 0 72u 100% 12u "Delete local app data from this PC"
    Pop $TsaBonnoDeleteDataCheckbox

    nsDialogs::Show
  FunctionEnd

  Function un.TsaBonnoDeleteDataPageLeave
    ${NSD_GetState} $TsaBonnoDeleteDataCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $TsaBonnoDeleteDataChoice "1"
    ${Else}
      StrCpy $TsaBonnoDeleteDataChoice "0"
    ${EndIf}
  FunctionEnd

  !macro customUnInstall
    ${If} $TsaBonnoDeleteDataChoice == "1"
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}

      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif

      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  !macroend
!endif
