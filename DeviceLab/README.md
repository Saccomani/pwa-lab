# DeviceLab

PWA local em Blazor WebAssembly para demonstrar recursos de navegador e do aparelho. Os testes são independentes, começam por ação explícita e mantêm amostras no próprio navegador. A câmera não é enviada; o leitor QR usa ZXing.Net no cliente. Push remoto não está configurado.

## Requisitos

- .NET SDK 10.x (este projeto foi compilado com SDK 10.0.301 e pacotes Blazor 10.0.9).
- Workload `wasm-tools`, se ainda não estiver instalado: `dotnet workload install wasm-tools`.

## Executar no computador

No terminal:

```sh
cd DeviceLab
dotnet restore DeviceLab.csproj
dotnet build DeviceLab.csproj -m:1
dotnet test DeviceLab.Tests/DeviceLab.Tests.csproj -m:1
dotnet run --project DeviceLab.csproj --no-launch-profile --urls http://localhost:5178
```

Abra <http://localhost:5178/> neste mesmo computador. `localhost` é tratado como contexto seguro para desenvolvimento pelo navegador; um endereço HTTP de rede local, como `http://192.168.x.x`, não é equivalente para APIs protegidas. No iPhone, `localhost` aponta para o próprio iPhone, não para o computador que executa o app.

O servidor de desenvolvimento não oferece o cache offline publicado. Para gerar os arquivos PWA:

```sh
dotnet publish DeviceLab.csproj -c Release -o ./artifacts/publish
```

Sirva o conteúdo de `artifacts/publish/wwwroot` em uma origem HTTPS confiável para testar instalação e offline. O host precisa servir o app na raiz `/` e preservar os tipos de conteúdo e arquivos estáticos publicados. A primeira abertura precisa de rede; depois que o service worker terminar de instalar e controlar a página, recarregue uma vez e teste a abertura sem rede. Para testar no próprio computador durante desenvolvimento, use HTTPS com um certificado confiável ao navegador, por exemplo o certificado local do SDK. Não ignore avisos de certificado.

### iPhone e Android

O teste por hardware real requer uma URL HTTPS confiável acessível no aparelho. O app aberto no Mac em `localhost` não é acessível como `localhost` pelo telefone, e acessar o IP local por HTTP não libera automaticamente câmera, localização, microfone, notificações ou instalação PWA. Não foi criado certificado, hospedagem, túnel ou serviço externo neste projeto.

- **iPhone/iPad:** abra a URL HTTPS no Safari, use **Compartilhar → Adicionar à Tela de Início** e abra o ícone instalado. A instalação, a disponibilidade de APIs e notificações variam com a versão do iOS/iPadOS e com a política do navegador. O Web Push no iOS/iPadOS 16.4+ exige o app web adicionado à Tela de Início, opt-in do usuário e um serviço remoto de push; este projeto não fornece esse serviço.
- **Android:** abra a mesma origem HTTPS em Chrome ou outro navegador compatível e use o comando de instalação do navegador. APIs e prompts variam por versão, fabricante e permissão do sistema.
- **Offline:** abra a versão publicada com rede, aguarde o service worker ser instalado, recarregue e só então desligue a rede no aparelho de teste. O service worker de desenvolvimento é deliberadamente sem cache.

## Bancadas

- LocalStorage: grava, lê e apaga a chave de demonstração.
- GPS: solicita uma leitura única depois do toque; o navegador pode combinar GPS, Wi-Fi ou rede celular.
- Câmera e QR: usa `getUserMedia` somente ao iniciar; imagem e decodificação ficam no dispositivo. O QR de amostra funciona sem câmera. O resultado é mostrado como texto e nunca abre links.
- Foto da câmera: com a prévia ativa, “Capturar foto” guarda um quadro JPEG reduzido apenas na memória desta sessão; você pode baixá-lo ou apagá-lo. A imagem é descartada ao sair da bancada.
- Notificação local: pede permissão após o toque e usa a API do service worker quando disponível. É uma notificação gerada localmente, não uma mensagem recebida em segundo plano.
- Cena WebGL: cubo animado; FPS observado por `requestAnimationFrame`, média, tempo médio por quadro, contagem e controle de carga. 60 FPS é uma referência visual, sem garantia universal. Carga alta pode usar bateria e aquecer o aparelho.
- IndexedDB, estado online/offline e instalação PWA.
- Microfone com leitura transitória de nível, sem gravação de arquivo; sensores de orientação/movimento; clipboard; compartilhamento do sistema; seleção local exibindo somente metadados; tela cheia; Wake Lock; vibração e detecção de interfaces avançadas.

Cada navegador decide se apresenta uma API e pode negar permissão. Testes de GPS, câmera, microfone, clipboard e notificação exibem só o que o navegador liberar. Botões de parar e a saída/ocultação da página liberam streams, listeners, Wake Lock e animação quando aplicável. O app não envia analytics nem dados de câmera, microfone ou localização. Não use informação sensível nos campos de demonstração.

### Gerar e enviar uma publicação Release

`scripts/release.sh` cria a versão otimizada Release, verifica os arquivos essenciais e transfere o conteúdo estático de `publish/wwwroot` via SSH para `/var/www/sacomani.com.br/pwa/`, usando `SSH_HOST`, `SSH_USER` e `SSH_PASS` do ambiente. `scripts/release-remote.sh` cria o diretório se necessário, copia os recursos primeiro e instala `index.html` por último. Os arquivos antigos não são apagados. No .NET 10, o manifesto de boot não é publicado como `_framework/blazor.boot.json`; ele é incorporado aos arquivos de inicialização fingerprinted, que o script verifica.

Esse fluxo só envia os arquivos. Ele não consulta nem altera DNS, Nginx, Certbot, portas do servidor ou HTTPS e não confirma que o domínio esteja online. A configuração da origem e do certificado é uma tarefa de infraestrutura separada. O vhost deverá servir o PWA na raiz do domínio; `index.html` e os service workers precisam poder revalidar para que atualizações do app sejam detectadas.

No Mac, com o .NET SDK, OpenSSH, `sshpass` e `tar` instalados, carregue os três valores SSH no ambiente sem gravá-los neste repositório e execute:

```sh
cd DeviceLab
./scripts/release.sh
```

O SSH verifica a chave do servidor já registrada no `known_hosts` (`StrictHostKeyChecking=yes`); valide e registre a chave do destino antes da primeira execução. A conta precisa gravar na pasta de destino ou ter `sudo` disponível para a cópia. A senha é lida pelo `sshpass` a partir do ambiente e não é escrita no repositório nem impressa pelo script.

### Notificação local e Push

Notificações do navegador e service workers dependem de contexto seguro (HTTPS; `http://localhost` serve para desenvolvimento). O browser ou sistema operacional controla permissão, apresentação e disponibilidade. Uma notificação local só é solicitada pelo botão da bancada. Push remoto é um recurso diferente: requer inscrição do dispositivo, chaves, um serviço que envie eventos e integração de servidor; nada disso existe aqui e a tela mostra **Não configurado**.

## Validação registrada

| Verificação | Resultado |
| --- | --- |
| `dotnet build DeviceLab.csproj -m:1` | Aprovado; zero avisos e zero erros (SDK 10.0.301). |
| `dotnet test DeviceLab.Tests/DeviceLab.Tests.csproj -m:1` | Aprovado; 6 testes xUnit do decodificador QR. |
| UI no browser local, viewport de 390 px | Carregou; sem overflow horizontal (largura de documento observada: 375 px). |
| Inicialização fria em `localhost` | Tela principal carregada, faixa de erro oculta e nenhum erro de console nesta abertura. |
| LocalStorage | Gravar/ler confirmou e apagar removeu a amostra. |
| IndexedDB | Gravar, ler e apagar amostra confirmados. |
| QR de demonstração | ZXing.Net decodificou `DEVICE-LAB-LOCAL-DEMO` sem abrir a câmera. |
| WebGL | A cena iniciou e parou; neste browser foram observados 100 FPS no intervalo, média 100,1 FPS e 10,0 ms por quadro. É uma medição desta execução, não uma meta garantida. |
| Hardware real, notificações do sistema, instalação PWA em iPhone/Android e permissão concedida/negada em aparelhos físicos | Pendente; não foram solicitados GPS/câmera/microfone reais durante esta validação. |
| Offline da versão publicada | Pendente até servir a pasta publicada em uma origem local/HTTPS e validar o ciclo do service worker. |

O runner VSTest precisou executar fora da restrição de socket loopback do sandbox. O ambiente também não conseguiu consultar o índice remoto de auditoria de vulnerabilidades do NuGet (`NU1900`); os 6 testes foram executados e passaram com os pacotes restaurados.

## Referências oficiais

- [Microsoft: ASP.NET Core Blazor e Blazor WebAssembly](https://learn.microsoft.com/aspnet/core/blazor/?view=aspnetcore-10.0)
- [Microsoft: cache de bundles e integridade no Blazor WebAssembly](https://learn.microsoft.com/aspnet/core/blazor/host-and-deploy/webassembly/bundle-caching-and-integrity-check-failures?view=aspnetcore-10.0)
- [MDN: Service Worker API e contexto seguro](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [MDN: Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API)
- [WebKit: Web Push para apps web no iOS e iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
