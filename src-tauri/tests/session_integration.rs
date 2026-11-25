use std::{collections::HashMap, net::SocketAddr, sync::Arc, time::Duration};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use finalpowershell_lib::{
    discover_remote_host_key, host_key_fingerprint, ConnectionProfile, SessionEvent, SessionManager,
};
use russh::{
    server::{Auth, ChannelOpenHandle, Msg, Server as _, Session},
    Channel, ChannelId, Pty,
};
use russh_sftp::protocol::{
    Data, File, FileAttributes, Handle, Name, SftpHandle, Status, StatusCode, Version,
};
use tokio::{net::TcpListener, sync::Mutex, time::timeout};

#[derive(Clone)]
struct TestServer;

impl russh::server::Server for TestServer {
    type Handler = TestHandler;

    fn new_client(&mut self, _: Option<SocketAddr>) -> Self::Handler {
        TestHandler::default()
    }
}

#[derive(Default)]
struct TestHandler {
    channels: Arc<Mutex<HashMap<ChannelId, Channel<Msg>>>>,
    terminal_channels: Arc<Mutex<HashMap<ChannelId, ()>>>,
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
        session.data(channel, b"\x1eHOST\nlocal-test\n\x1eSYSTEM\nLinux 6.1 x86_64\n\x1eCPU\ncpu 100 0 100 700 100 0 0 0 0 0\n\x1eMEMORY\nMemTotal: 1000 kB\nMemAvailable: 250 kB\nSwapTotal: 500 kB\nSwapFree: 250 kB\n\x1eLOAD\n0.10 0.20 0.30 1/100 1\n\x1eDISK\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 1000 250 750 25% /\n\x1eMOUNTS\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 1000 250 750 25% /\n\x1eUPTIME\n3600.50 0.00\n\x1eNETWORK\nInter-| Receive | Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n eth0: 1024 0 0 0 0 0 0 0 2048 0 0 0 0 0 0 0\n\x1ePROCESSES\nCOMMAND %CPU RSS\nserver 12.5 128\nshell 2.5 64\n\x1eCOMPLETE\n".to_vec())?;
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
        russh_sftp::server::run(channel.into_stream(), TestSftp::default()).await;
        Ok(())
    }
}

#[derive(Default)]
struct TestSftp {
    listed: bool,
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
            handle: path.into(),
        })
    }

    async fn readdir(&mut self, id: u32, _: SftpHandle) -> Result<Name, Self::Error> {
        if self.listed {
            return Err(StatusCode::Eof);
        }
        self.listed = true;
        let mut attributes = FileAttributes::default();
        attributes.set_dir(true);
        let directory = File::new("docs", attributes);
        Ok(Name {
            id,
            files: vec![directory],
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
        _path: String,
        _pflags: russh_sftp::protocol::OpenFlags,
        _attrs: FileAttributes,
    ) -> Result<Handle, Self::Error> {
        Ok(Handle {
            id,
            handle: "metrics".into(),
        })
    }

    async fn read(
        &mut self,
        _id: u32,
        _handle: SftpHandle,
        _offset: u64,
        _len: u32,
    ) -> Result<Data, Self::Error> {
        Err(StatusCode::Eof)
    }
}

#[tokio::test]
async fn terminal_round_trip_and_sftp_listing_work_together() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let host_key =
        russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519).unwrap();
    let host_key_openssh = host_key.public_key().to_openssh().unwrap();
    let expected_fingerprint = host_key_fingerprint(host_key.public_key());
    let config = Arc::new(russh::server::Config {
        keys: vec![host_key],
        inactivity_timeout: Some(Duration::from_secs(60)),
        ..Default::default()
    });
    let server_task = tokio::spawn(async move {
        let mut test_server = TestServer;
        test_server.run_on_socket(config, &listener).await
    });
    let discovered = discover_remote_host_key("127.0.0.1", port).await.unwrap();
    assert_eq!(discovered.host_key, host_key_openssh);
    assert_eq!(discovered.fingerprint, expected_fingerprint);

    let manager = SessionManager::new();
    let profile = ConnectionProfile {
        id: "local-only".into(),
        name: "Local test".into(),
        host: "127.0.0.1".into(),
        port,
        username: "integration".into(),
        auth: finalpowershell_lib::AuthKind::Password,
        private_key_path: None,
        updated_at: 0,
    };
    let session_id = manager
        .connect(
            profile,
            Some("temporary-test-password".into()),
            Some(host_key_openssh.clone()),
        )
        .await
        .unwrap();
    let mut events = manager.subscribe(&session_id).unwrap();
    let initial = timeout(Duration::from_secs(5), async {
        loop {
            if let SessionEvent::Output { data, .. } = events.recv().await.unwrap() {
                let text = String::from_utf8(BASE64.decode(data).unwrap()).unwrap();
                if text.contains("local-test-shell") {
                    break;
                }
            }
        }
    })
    .await;
    assert!(initial.is_ok(), "terminal receives initial shell output");

    manager.input(&session_id, b"ping".to_vec()).await.unwrap();
    manager.resize(&session_id, 100, 40).await.unwrap();
    let echo = timeout(Duration::from_secs(5), async {
        loop {
            if let SessionEvent::Output { data, .. } = events.recv().await.unwrap() {
                let text = String::from_utf8(BASE64.decode(data).unwrap()).unwrap();
                if text.contains("echo: ping") {
                    break;
                }
            }
        }
    })
    .await;
    assert!(
        echo.is_ok(),
        "terminal input returns through the split channel"
    );

    let entries = manager.list_directory(&session_id, "/").await.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "docs");
    assert!(entries[0].is_dir);
    let metrics = manager.system_metrics(&session_id).await.unwrap();
    assert_eq!(metrics.hostname, "local-test");
    assert_eq!(metrics.memory_percent, 75.0);
    let second_session_id = manager
        .connect(
            ConnectionProfile {
                id: "local-second".into(),
                name: "Second local test".into(),
                host: "127.0.0.1".into(),
                port,
                username: "integration".into(),
                auth: finalpowershell_lib::AuthKind::Password,
                private_key_path: None,
                updated_at: 0,
            },
            Some("temporary-test-password".into()),
            Some(host_key_openssh),
        )
        .await
        .unwrap();
    manager.input(&session_id, b"first".to_vec()).await.unwrap();
    manager
        .input(&second_session_id, b"second".to_vec())
        .await
        .unwrap();
    assert_eq!(
        manager
            .list_directory(&second_session_id, "/")
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        manager
            .system_metrics(&second_session_id)
            .await
            .unwrap()
            .hostname,
        "local-test"
    );
    manager.disconnect(&second_session_id).await.unwrap();
    manager.disconnect(&session_id).await.unwrap();
    server_task.abort();
    let _ = server_task.await;
}

#[test]
fn windows_credential_store_round_trip() {
    let id = format!("codex-temporary-test-{}", uuid::Uuid::new_v4());
    finalpowershell_lib::credential_round_trip_test(&id, "temporary-not-a-real-password").unwrap();
}
