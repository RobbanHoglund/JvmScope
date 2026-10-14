import java.lang.management.ManagementFactory;
import java.nio.file.*;
import javax.management.ObjectName;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.locks.*;
class AllocationProbe {
 static volatile Object sink;
 static volatile boolean run=true;
 static volatile long target;
 static volatile CountDownLatch complete;
 static final com.sun.management.ThreadMXBean MX=(com.sun.management.ThreadMXBean)ManagementFactory.getThreadMXBean();
 static void worker(){
  while(run){LockSupport.park();if(!run)return;
   while(MX.getThreadAllocatedBytes(Thread.currentThread().threadId())<target){
    long remaining=target-MX.getThreadAllocatedBytes(Thread.currentThread().threadId());
    sink=new byte[(int)Math.max(0,Math.min(1048560,remaining-16))];
   }
   complete.countDown();
  }
 }
 static void dump(String path)throws Exception{
  String data=(String)ManagementFactory.getPlatformMBeanServer().invoke(new ObjectName("com.sun.management:type=DiagnosticCommand"),"threadPrint",new Object[]{new String[]{"-e","-l"}},new String[]{String[].class.getName()});
  Files.writeString(Path.of(path),data);System.out.println("DUMPED");
 }
 public static void main(String[] args)throws Exception{
  BufferedReader in=new BufferedReader(new InputStreamReader(System.in));
  Thread worker=Thread.ofPlatform().daemon().name("audit-allocation-boundary").start(AllocationProbe::worker);
  System.out.println("READY");String cmd;
  while((cmd=in.readLine())!=null&&!cmd.equals("quit")){
   if(cmd.startsWith("dump ")){dump(cmd.substring(5));continue;}
   complete=new CountDownLatch(1);
   target=cmd.equals("prime")?101L*1024*1024*1024-65536:MX.getThreadAllocatedBytes(worker.threadId())+131072;
   LockSupport.unpark(worker);complete.await();
   System.out.println("ALLOCATED="+MX.getThreadAllocatedBytes(worker.threadId()));
  }
  run=false;LockSupport.unpark(worker);worker.join();
 }
}
