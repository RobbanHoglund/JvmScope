import java.lang.management.*;
import java.nio.file.*;
import javax.management.ObjectName;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.locks.*;
class CoverageProbe {
 public static void main(String[] args)throws Exception {
  Path output=Path.of(args[0]).toAbsolutePath();
  Files.createDirectories(output.getParent());
  String base=output.toString();
  ReentrantLock ownable=new ReentrantLock();CountDownLatch held=new CountDownLatch(1);
  Thread owner=Thread.ofPlatform().daemon().name("audit-ownable-owner").start(()->{ownable.lock();held.countDown();LockSupport.park();ownable.unlock();});held.await();
  Object a=new Object(),b=new Object();CountDownLatch both=new CountDownLatch(2);
  Thread one=Thread.ofVirtual().name("audit-virtual-deadlock-a").start(()->{synchronized(a){both.countDown();try{both.await();}catch(InterruptedException e){throw new RuntimeException(e);}synchronized(b){}}});
  Thread two=Thread.ofVirtual().name("audit-virtual-deadlock-b").start(()->{synchronized(b){both.countDown();try{both.await();}catch(InterruptedException e){throw new RuntimeException(e);}synchronized(a){}}});
  long deadline=System.nanoTime()+5_000_000_000L;
  while((one.getState()!=Thread.State.BLOCKED||two.getState()!=Thread.State.BLOCKED)&&System.nanoTime()<deadline)Thread.sleep(1);
  if(one.getState()!=Thread.State.BLOCKED||two.getState()!=Thread.State.BLOCKED)throw new AssertionError("Deadlock not established");
  ThreadMXBean mx=ManagementFactory.getThreadMXBean();
  var info=mx.getThreadInfo(new long[]{owner.threadId()},true,true)[0];
  System.out.println("ownableHeld="+info.getLockedSynchronizers().length+", vt1="+one.getState()+", vt2="+two.getState()+", platformDeadlockReport="+java.util.Arrays.toString(mx.findDeadlockedThreads()));
  for(boolean locks:new boolean[]{false,true}) {
   String data=(String)ManagementFactory.getPlatformMBeanServer().invoke(new ObjectName("com.sun.management:type=DiagnosticCommand"),"threadPrint",new Object[]{locks?new String[]{"-l"}:new String[]{}},new String[]{String[].class.getName()});
   Files.writeString(Path.of(base+(locks?"-with-locks.txt":"-default.txt")),data);
  }
  ManagementFactory.getPlatformMXBean(com.sun.management.HotSpotDiagnosticMXBean.class).dumpThreads(base+".json",com.sun.management.HotSpotDiagnosticMXBean.ThreadDumpFormat.JSON);
 }
}
