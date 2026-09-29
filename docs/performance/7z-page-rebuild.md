# Medição local da reconstrução de páginas 7z

## Método

`LibraryDbTest.sevenZipPageRebuildTimingProbe` cria arquivos 7z com 50, 100 e 200 páginas PNG pequenas, importa cada arquivo e mede `ensurePage()` para a primeira página, a intermediária e a seguinte. Cada página medida é solicitada uma vez e reconstruída no cache sob demanda. A medição usa `System.nanoTime()` e não impõe um limite de desempenho.

Reproduza com:

```powershell
$env:TEMP = 'C:\tmp'
$env:TMP = 'C:\tmp'
cd native
./gradlew.bat testDebugUnitTest --tests 'com.jrmello4.tactilereader.core.LibraryDbTest.sevenZipPageRebuildTimingProbe' --no-daemon
```

## Resultado de 29/09/2026

Medição JVM/Robolectric em Windows x64 com JDK Zulu 21; não é uma medição no Moto G34. Valores em milissegundos:

| Páginas | Primeira | Intermediária | Seguinte |
|---:|---:|---:|---:|
| 50 | 6,4–20,6 | 20,0–24,0 | 21,4–24,6 |
| 100 | 6,2–10,9 | 38,6–43,0 | 35,2–45,2 |
| 200 | 9,2–11,0 | 70,9–80,4 | 69,7–79,1 |

Cada célula mostra a faixa de duas execuções (probe isolado e suíte completa). O tempo da primeira página variou com aquecimento do processo e cache do sistema operacional. As páginas intermediárias e seguintes cresceram aproximadamente com o número de entradas, compatível com reabrir o arquivo e percorrê-lo até o membro pedido. Nesta amostra sintética, uma página de 200 entradas levou até cerca de 80 ms no host. Isso não caracteriza arquivos grandes ou compactação pesada nem prevê o tempo em aparelho Android; uma medição física continua pendente. Nenhuma otimização foi aplicada.
