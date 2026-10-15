# Gunicorn configuration file
import multiprocessing

# Server socket
bind = "0.0.0.0:8000"
backlog = 2048

# Worker processes
# Tăng từ 2 -> 6 (2026-09-16): với chỉ 2 sync worker, TOÀN BỘ backend chỉ xử lý
# được 2 request cùng lúc -> góp phần gây trang Phê duyệt "load mãi ko xong"
# (request phải xếp hàng chờ worker rảnh, cộng dồn vào độ trễ N+1 đã fix riêng).
# Server dùng chung (28 core, ~18GB RAM trống lúc đo, DB max_connections=300
# chỉ đang dùng ~27) -> dư sức tăng lên 6 mà không ảnh hưởng
# các service khác chạy chung máy.
workers = 6
worker_class = "sync"
worker_connections = 1000
timeout = 300  # Increased timeout to 5 minutes for large file uploads
keepalive = 2

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"

# Process naming
proc_name = "hrm_backend"

# Server mechanics
daemon = False
pidfile = None
umask = 0
user = None
group = None
tmp_upload_dir = None

# SSL (not enabled by default)
# keyfile = None
# certfile = None

# Worker processes
spew = False

# Server hooks
def post_fork(server, worker):
    server.log.info("Worker spawned (pid: %s)", worker.pid)

def pre_fork(server, worker):
    pass

def pre_exec(server):
    server.log.info("Forked child, re-executing.")

def when_ready(server):
    server.log.info("Server is ready. Spawning workers")

def worker_int(worker):
    worker.log.info("worker received INT or QUIT signal")

def worker_abort(worker):
    worker.log.info("worker received SIGABRT signal")