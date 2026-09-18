# Arquitetura de Segurança do Atualizador In-App

## 1. Visão Geral
O Tactile Reader inclui um mecanismo nativo de atualização in-app seguro (`com.jrmello4.tactilereader.settings.Updater`), projetado para ambientes de distribuição direta (Sideload / GitHub Releases) sem intermediários ou lojas de terceiros, garantindo integridade criptográfica ponta-a-ponta e resistência contra adulteração de tráfego, pacotes corrompidos, open redirects e ataques de downgrade.

## 2. Princípios e Controles Implementados

### 2.1 Conexões HTTPS Estritas e Allowlist de Domínios
- Conexões em texto plano (`http://`) são expressamente proibidas em produção fora de loopback (`127.0.0.1`, `localhost`, `[::1]` usados exclusivamente para testes automatizados).
- Toda URL de consulta de API ou de download de APK é validada contra uma lista estrita de domínios permitidos (`UpdateSecurity.ALLOWED_HOSTS`):
  - `github.com`
  - `api.github.com`
  - `raw.githubusercontent.com`
  - `objects.githubusercontent.com`
  - `github-releases.githubusercontent.com`
  - `githubusercontent.com` (e subdomínios autorizados)
- Domínios não autorizados lançam `SecurityException` imediata antes de qualquer abertura de socket.

### 2.2 Inspeção Segura de Redirecionamentos (Safe Redirect Inspection)
- Redirecionamentos HTTP automáticos pelo cliente (`instanceFollowRedirects = false`) são desabilitados.
- O atualizador segue manualmente até no máximo 5 saltos (`hops <= 5`).
- Cada salto intermediário (`Location`) é inspecionado e revalidado contra a allowlist de domínios e a regra de protocolo HTTPS antes da nova requisição.
- Redirecionamentos para esquemas não-HTTPS ou hosts fora da allowlist abortam imediatamente com `SecurityException`.

### 2.3 Validação de Integridade Criptográfica Obrigatória (SHA-256)
- **Hash Obrigatório**: O corpo da release publicada no GitHub deve declarar explicitamente o hash de integridade (`SHA-256: <64 hex>`). Se ausente ou inválido, a oferta da atualização é bloqueada preventivamente (`expectedSha256 = null`).
- **Bloqueio Antes de Gravação**: `UpdateDownloader.download` exige um hash SHA-256 válido como parâmetro obrigatório. Caso seja nulo, vazio ou diferente de 64 caracteres hexadecimais, o download é interrompido com `SecurityException` antes de tocar no sistema de arquivos.
- **Validação de Digest em Streaming**: O download do arquivo computa iterativamente o digest SHA-256 via streaming à medida que os buffers são gravados em disco.
- Ao término do download:
  - Se o hash computado divergir do esperado, o arquivo adulterado é **imediatamente excluído** do armazenamento e uma `SecurityException("Integridade violada...")` é disparada.
  - Arquivos com tamanho zero ou truncados são descartados.

### 2.4 Validação Prévia no Aparelho com Falha Fechada (`UpdateValidator`)
Antes de acionar a `Intent.ACTION_VIEW` com o `FileProvider` para iniciar o instalador do sistema Android, o APK passa por 4 checagens locais estritas:
1. **Verificação de Truncamento**: O arquivo deve existir e possuir tamanho mínimo plausível (>= 100 KB).
2. **Identidade do Pacote**: `archiveInfo.packageName` deve coincidir exatamente com o pacote em execução (`context.packageName` = `com.jrmello4.tactilereader.scaffold`).
3. **Prevenção de Downgrade**: `archiveInfo.versionCode` deve ser estritamente superior ao `versionCode` do aplicativo atualmente instalado. Pacotes com versão menor ou igual são bloqueados.
4. **Validação de Certificado de Assinatura com Falha Fechada (Fail-Closed)**:
   - Suporte completo a partir do `minSdk 26`: em Android 9+ (API 28+), usa `PackageManager.GET_SIGNING_CERTIFICATES` com `signingInfo` (`apkContentsSigners` e `signingCertificateHistory`). Em API 26/27 ou como fallback resiliente, usa `PackageManager.GET_SIGNATURES`.
   - **Falha Fechada**: Se não for possível obter os certificados do pacote instalado OU do arquivo APK baixado, a operação aborta imediatamente com `SecurityException`.
   - Se os certificados não coincidirem, a instalação é bloqueada.

## 3. Matriz de Testes Automatizados
Os controles de segurança são auditados por suítes contínuas:
- `com.jrmello4.tactilereader.settings.UpdateSecurityTest`: Prova rejeição de domínios externos, bloqueio de HTTP em produção, cálculo de SHA-256, bloqueio preventivo antes de tocar o disco quando o hash é ausente/inválido, redirecionamento seguro dentro da allowlist, bloqueio de redirecionamento para host malicioso, detecção e descarte de arquivos adulterados, rejeição de downgrades e falha fechada de certificados.
- `com.jrmello4.tactilereader.settings.UpdateCheckTest`: Prova extração de version code, escolha preferencial por binários assinados de release e controle de teto de tamanho (máximo 200 MB por APK).
