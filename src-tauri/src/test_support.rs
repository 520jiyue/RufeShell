use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

use russh::{
    server::{Auth, ChannelOpenHandle, Msg, Server as _, Session},
    Channel, ChannelId, Pty,
};
use russh_sftp::protocol::{
    Data, File, FileAttributes, Handle, Name, SftpHandle, Status, StatusCode, Version,
};
use tokio::{net::TcpListener, sync::Mutex};

pub struct TestServerInfo {
    pub port: u16,
    pub host_key: String,
}

#[derive(Clone)]
struct TestServer {
    exec_count: Arc<AtomicUsize>,
    directory_count: Arc<AtomicUsize>,
    files: Arc<Mutex<Vec<File>>>,
    text: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

#[derive(Default)]
struct TestHandler {
    channels: Arc<Mutex<HashMap<ChannelId, Channel<Msg>>>>,
    terminal_channels: Arc<Mutex<HashMap<ChannelId, ()>>>,
    exec_count: Arc<AtomicUsize>,
    directory_count: Arc<AtomicUsize>,
    files: Arc<Mutex<Vec<File>>>,
    text: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

impl russh::server::Server for TestServer {
    type Handler = TestHandler;

    fn new_client(&mut self, _: Option<SocketAddr>) -> Self::Handler {
        TestHandler {
            exec_count: self.exec_count.clone(),
            directory_count: self.directory_count.clone(),
            files: self.files.clone(),
            text: self.text.clone(),
            ..Default::default()
        }
    }
}

impl russh::server::Handler for TestHandler {
    type Error = anyhow::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == "integration" && password == "temporary-test-password" {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::Reject {
                proceed_with_methods: None,
                partial_success: false,
            })
        }
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.lock().await.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _term: &str,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.terminal_channels.lock().await.insert(channel, ());
        session.channel_success(channel)?;
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        session.data(channel, b"local-test-shell\r\n".to_vec())?;
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if !self.terminal_channels.lock().await.contains_key(&channel) {
            return Ok(());
        }
        let mut response = b"echo: ".to_vec();
        response.extend_from_slice(data);
        session.data(channel, response)?;
        Ok(())
    }

    async fn window_change_request(
        &mut self,
        channel: ChannelId,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        _command: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.terminal_channels.lock().await.insert(channel, ());
        session.channel_success(channel)?;
        let count = self.exec_count.fetch_add(1, Ordering::SeqCst);
        if count % 4 == 1 {
            session.data(channel, b"temporary metrics failure".to_vec())?;
        } else {
            session.data(channel, b"\x1eHOST\nlocal-test\n\x1eSYSTEM\nLinux 6.1 x86_64\n\x1eCPU\ncpu 100 0 100 700 100 0 0 0 0 0\n\x1eMEMORY\nMemTotal: 1000 kB\nMemAvailable: 250 kB\nSwapTotal: 500 kB\nSwapFree: 250 kB\n\x1eLOAD\n0.10 0.20 0.30 1/100 1\n\x1eDISK\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 1000 250 750 25% /\n\x1eMOUNTS\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 1000 250 750 25% /\n\x1eUPTIME\n3600.50 0.00\n\x1eNETWORK\nInter-| Receive | Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n eth0: 1024 0 0 0 0 0 0 0 2048 0 0 0 0 0 0 0\n\x1ePROCESSES\nCOMMAND %CPU RSS\nserver 12.5 128\nshell 2.5 64\n\x1eCOMPLETE\n".to_vec())?;
        }
        session.eof(channel)?;
        session.close(channel)?;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if name != "sftp" {
            session.channel_failure(channel)?;
            return Ok(());
        }
        let channel = self
            .channels
            .lock()
            .await
            .remove(&channel)
            .expect("SFTP channel exists");
        session.channel_success(channel.id())?;
        russh_sftp::server::run(
            channel.into_stream(),
            TestSftp {
                directory_count: self.directory_count.clone(),
                listed: HashMap::new(),
                text: self.text.clone(),
                files: self.files.clone(),
            },
        )
        .await;
        Ok(())
    }
}

#[derive(Default)]
struct TestSftp {
    directory_count: Arc<AtomicUsize>,
    listed: HashMap<Vec<u8>, bool>,
    text: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    files: Arc<Mutex<Vec<File>>>,
}

impl russh_sftp::server::Handler for TestSftp {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn init(&mut self, _: u32, _: HashMap<String, String>) -> Result<Version, Self::Error> {
        Ok(Version::new())
    }

    async fn close(&mut self, id: u32, _: SftpHandle) -> Result<Status, Self::Error> {
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: "Ok".into(),
            language_tag: "en-US".into(),
        })
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, Self::Error> {
        Ok(Handle {
            id,
            handle: format!(
                "{path}:{}",
                self.directory_count.fetch_add(1, Ordering::SeqCst)
            )
            .into(),
        })
    }

    async fn readdir(&mut self, id: u32, handle: SftpHandle) -> Result<Name, Self::Error> {
        if self.listed.get(handle.as_bytes()).copied().unwrap_or(false) {
            return Err(StatusCode::Eof);
        }
        self.listed.insert(handle.into_bytes(), true);
        let mut files = self.files.lock().await;
        if files.is_empty() {
            let mut attributes = FileAttributes::default();
            attributes.set_dir(true);
            files.extend([
                File::new("docs", attributes),
                File::new(
                    "notes.txt",
                    FileAttributes {
                        size: Some(18),
                        ..Default::default()
                    },
                ),
            ]);
        }
        Ok(Name {
            id,
            files: files.clone(),
        })
    }

    async fn realpath(&mut self, id: u32, _: String) -> Result<Name, Self::Error> {
        Ok(Name {
            id,
            files: vec![File::dummy("/")],
        })
    }

    async fn open(
        &mut self,
        id: u32,
        path: String,
        pflags: russh_sftp::protocol::OpenFlags,
        _attrs: FileAttributes,
    ) -> Result<Handle, Self::Error> {
        if pflags.contains(russh_sftp::protocol::OpenFlags::CREATE) {
            let name = path.rsplit('/').next().unwrap_or(&path);
            let mut files = self.files.lock().await;
            if !files.iter().any(|file| file.filename == name) {
                files.push(File::new(name, FileAttributes::default()));
            }
        }
        Ok(Handle {
            id,
            handle: path.into(),
        })
    }

    async fn read(
        &mut self,
        id: u32,
        handle: SftpHandle,
        offset: u64,
        _len: u32,
    ) -> Result<Data, Self::Error> {
        let contents = self.text.lock().await;
        let text = contents
            .get(&String::from_utf8_lossy(handle.as_bytes()).into_owned())
            .map(Vec::as_slice)
            .unwrap_or(b"temporary test text");
        if offset as usize >= text.len() {
            return Err(StatusCode::Eof);
        }
        Ok(Data {
            id,
            data: text[offset as usize..].to_vec(),
        })
    }

    async fn write(
        &mut self,
        id: u32,
        handle: SftpHandle,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, Self::Error> {
        let mut contents = self.text.lock().await;
        let text = contents
            .entry(String::from_utf8_lossy(handle.as_bytes()).into_owned())
            .or_default();
        if offset == 0 {
            text.clear();
        }
        text.extend_from_slice(&data);
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: "Ok".into(),
            language_tag: "en-US".into(),
        })
    }

    async fn stat(
        &mut self,
        id: u32,
        path: String,
    ) -> Result<russh_sftp::protocol::Attrs, Self::Error> {
        let name = path.rsplit('/').next().unwrap_or(&path);
        let files = self.files.lock().await;
        if !files.is_empty() && !files.iter().any(|file| file.filename == name) {
            return Err(StatusCode::NoSuchFile);
        }
        Ok(russh_sftp::protocol::Attrs {
            id,
            attrs: FileAttributes {
                size: Some(18),
                ..Default::default()
            },
        })
    }

    async fn setstat(
        &mut self,
        id: u32,
        _path: String,
        _attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: "Ok".into(),
            language_tag: "en-US".into(),
        })
    }

    async fn lstat(
        &mut self,
        _id: u32,
        _path: String,
    ) -> Result<russh_sftp::protocol::Attrs, Self::Error> {
        Err(StatusCode::NoSuchFile)
    }
}

pub async fn start_test_server() -> TestServerInfo {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let host_key =
        russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519).unwrap();
    let host_key_openssh = host_key.public_key().to_openssh().unwrap();
    let config = Arc::new(russh::server::Config {
        keys: vec![host_key],
        inactivity_timeout: Some(std::time::Duration::from_secs(60)),
        ..Default::default()
    });
    tokio::spawn(async move {
        let mut server = TestServer {
            exec_count: Arc::new(AtomicUsize::new(0)),
            directory_count: Arc::new(AtomicUsize::new(0)),
            files: Arc::new(Mutex::new(Vec::new())),
            text: Arc::new(Mutex::new(HashMap::new())),
        };
        server.run_on_socket(config, &listener).await
    });
    TestServerInfo {
        port,
        host_key: host_key_openssh,
    }
}
