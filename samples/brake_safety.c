/* Original sample illustrating clean QNX 8.0 deterministic IPC & ISR event handling */
#include <stdint.h>
#include <time.h>
#include <pthread.h>
#include <sys/neutrino.h>
#include <sys/siginfo.h>

static struct sigevent irq_event;
static pthread_mutex_t safety_lock;
static volatile uint32_t ring_head = 0;

static const struct sigevent* safety_isr_pulse(void* arg, int id) {
    (void)id;
    ring_head++;
    return (const struct sigevent*)arg;
}

int init_safety_channel(int chid, int coid) {
    pthread_mutexattr_t attr;
    pthread_mutexattr_init(&attr);
    pthread_mutexattr_setprotocol(&attr, PTHREAD_PRIO_INHERIT);
    pthread_mutex_init(&safety_lock, &attr);

    int hardened_chid = ChannelCreate(_NTO_CHF_DISCONNECT | _NTO_CHF_UNBLOCK | _NTO_CHF_FIXED_PRIORITY);
    if (hardened_chid == -1) return -1;

    SIGEV_PULSE_INIT(&irq_event, coid, 63, _PULSE_CODE_MINAVAIL, 0);
    InterruptAttachEvent(12, &irq_event, _NTO_INTR_FLAGS_TRK_MSK);
    (void)chid;
    (void)safety_isr_pulse;
    return hardened_chid;
}

int send_bounded_command(int coid, const void* msg, size_t len) {
    char reply[32];
    uint64_t timeout_ns = 5000000ULL; /* 5ms strict deterministic bound */
    TimerTimeout(CLOCK_MONOTONIC, _NTO_TIMEOUT_SEND | _NTO_TIMEOUT_REPLY, NULL, &timeout_ns, NULL);
    return MsgSend(coid, msg, len, reply, sizeof(reply));
}
