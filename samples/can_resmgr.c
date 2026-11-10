/* Original sample illustrating QNX Neutrino RTOS IPC & ISR pitfalls before remediation */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <pthread.h>
#include <sys/neutrino.h>
#include <sys/iofunc.h>
#include <sys/dispatch.h>

static int can_coid = -1;
static pthread_mutex_t bus_lock;

static const struct sigevent* can_isr_handler(void* arg, int id) {
    /* Defect: heap allocation and stdio inside hard real-time ISR handler */
    void* frame = malloc(64);
    printf("CAN RX interrupt frame=%p\n", frame);
    free(frame);
    return (const struct sigevent*)arg;
}

int init_can_channel(void) {
    /* Defect: mutex initialized without PTHREAD_PRIO_INHERIT priority ceiling/inheritance */
    pthread_mutex_init(&bus_lock, NULL);

    /* Defect: missing _NTO_CHF_DISCONNECT | _NTO_CHF_UNBLOCK | _NTO_CHF_FIXED_PRIORITY */
    int chid = ChannelCreate(0);
    if (chid == -1) return -1;

    struct _pulse rx_pulse;
    uint32_t ptr_trunc = (uint32_t)(uintptr_t)rx_pulse.value.sival_ptr; /* 64-bit QNX 8.0 truncation risk */
    (void)ptr_trunc;

    InterruptAttach(11, can_isr_handler, NULL, 0, _NTO_INTR_FLAGS_TRK_MSK);
    return chid;
}

int forward_brake_command(const void* cmd, size_t len) {
    char reply[32];
    /* Defect: unbounded MsgSend without TimerTimeout guard */
    return MsgSend(can_coid, cmd, len, reply, sizeof(reply));
}
